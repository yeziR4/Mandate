import { Link } from "react-router-dom";
import type { Model } from "../lib/arena";
import { pad, timeAgo, usd } from "../lib/format";
import { Pill } from "./Pill";

export default function ModelRow({ model, bounty }: { model: Model; bounty: bigint }) {
  return (
    <div className={`board__row${model.broken ? " board__row--broken" : ""}`}>
      <span className="board__id">{pad(model.id)}</span>

      <div className="board__name">
        <span className="board__model">{model.label}</span>
        <span className="board__sub">{model.configured ? "mandate v1" : "unconfigured"}</span>
      </div>

      <div className="board__pill">
        <Pill state={model.broken ? "broken" : "live"} />
      </div>

      <span className={`board__purse${model.broken ? " board__purse--dead" : ""}`}>
        {model.broken ? "claimed" : usd(bounty)}
      </span>

      <span className="board__att">{model.attempts.toLocaleString("en-US")}</span>

      <span className="board__held">{model.broken ? timeAgo(model.brokenAt) : "—"}</span>

      <span className="board__cta">Open</span>

      <Link className="rowlink" to={`/model/${model.id}`} aria-label={`Open ${model.label}`} />
    </div>
  );
}
