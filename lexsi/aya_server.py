"""
OpenAI-compatible server for a local Cohere Aya model.

Why this exists: the hackathon harness already speaks the OpenAI chat-completions protocol
(streaming, tools, usage). Rather than fork the agent loop for a new provider, we put the model
behind the same protocol and point AYABASE at it. Nothing else in the pipeline changes.

    python lexsi/aya_server.py --model CohereLabs/tiny-aya-global --port 8080
    # then: OTARI_BASE_URL=http://127.0.0.1:8080/v1  OTARI_API_KEY=local

Streaming is implemented because a non-streamed request that takes longer than about thirty
seconds is killed by proxies; more importantly the harness relies on streaming to distinguish a
slow model from a dead one.
"""
from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

STATE: dict[str, Any] = {}


def load(model_name: str, dtype: str) -> None:
    print(f"loading {model_name} ({dtype}) ...", flush=True)
    started = time.time()
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    torch_dtype = {"bfloat16": torch.bfloat16, "float32": torch.float32}[dtype]
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch_dtype,
        device_map=None,
        low_cpu_mem_usage=True,
    )
    model.eval()
    STATE["tokenizer"] = tokenizer
    STATE["model"] = model
    STATE["name"] = model_name
    print(f"ready in {time.time() - started:.1f}s", flush=True)


def render(messages: list[dict[str, str]]) -> str:
    """Use the model's chat template when it has one, otherwise a plain transcript."""
    tokenizer = STATE["tokenizer"]
    if getattr(tokenizer, "chat_template", None):
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    lines = []
    for message in messages:
        role = message.get("role", "user")
        lines.append(f"{role.capitalize()}: {message.get('content', '')}")
    lines.append("Assistant:")
    return "\n".join(lines)


def generate(prompt: str, max_tokens: int, temperature: float):
    tokenizer = STATE["tokenizer"]
    model = STATE["model"]

    inputs = tokenizer(prompt, return_tensors="pt")
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    kwargs = dict(
        **inputs,
        max_new_tokens=max_tokens,
        do_sample=temperature > 0,
        temperature=max(temperature, 0.01),
        pad_token_id=tokenizer.eos_token_id,
        streamer=streamer,
    )
    thread = threading.Thread(target=model.generate, kwargs=kwargs)
    thread.start()
    return streamer, thread, inputs["input_ids"].shape[-1]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter logs
        print(f"{time.strftime('%H:%M:%S')} {fmt % args}", flush=True)

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [{"id": STATE["name"], "object": "model"}]})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._json(404, {"error": "not found"})
            return

        length = int(self.headers.get("content-length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        messages = request.get("messages") or []
        max_tokens = int(request.get("max_tokens") or 512)
        stream = bool(request.get("stream"))
        temperature = float(request.get("temperature") or 0.0)

        prompt = render(messages)
        # Tools are advertised to the model as text: small open models handle a protocol in the
        # prompt far better than native JSON function calling.
        tools = request.get("tools") or []
        if tools:
            names = [t.get("function", {}).get("name") for t in tools]
            prompt += "\n\nAvailable tools: " + ", ".join(str(name) for name in names if name)

        streamer, thread, prompt_tokens = generate(prompt, max_tokens, temperature)
        created = int(time.time())
        completion_tokens = 0

        if stream:
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("cache-control", "no-cache")
            self.send_header("transfer-encoding", "chunked")
            self.end_headers()

            def frame(payload: dict[str, Any]) -> None:
                data = f"data: {json.dumps(payload)}\n\n".encode()
                self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
                self.wfile.flush()

            frame({"id": "chatcmpl-local", "object": "chat.completion.chunk", "created": created,
                   "model": STATE["name"], "choices": [{"index": 0, "delta": {"role": "assistant"}}]})
            for piece in streamer:
                if not piece:
                    continue
                completion_tokens += 1
                frame({"id": "chatcmpl-local", "object": "chat.completion.chunk", "created": created,
                       "model": STATE["name"],
                       "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]})
            frame({"id": "chatcmpl-local", "object": "chat.completion.chunk", "created": created,
                   "model": STATE["name"],
                   "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                   "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                             "total_tokens": prompt_tokens + completion_tokens}})
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            thread.join()
            return

        text = ""
        for piece in streamer:
            text += piece
            completion_tokens += 1
        thread.join()
        self._json(200, {
            "id": "chatcmpl-local",
            "object": "chat.completion",
            "created": created,
            "model": STATE["name"],
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                      "total_tokens": prompt_tokens + completion_tokens},
        })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="CohereLabs/tiny-aya-global")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float32"])
    args = parser.parse_args()

    load(args.model, args.dtype)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"listening on http://127.0.0.1:{args.port}/v1", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
