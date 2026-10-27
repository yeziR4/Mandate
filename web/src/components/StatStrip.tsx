export interface Stat {
  label: string;
  value: string;
  note?: string;
}

export default function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="stats">
      {stats.map((stat) => (
        <div className="stat" key={stat.label}>
          <div className="stat__label">{stat.label}</div>
          <div className="stat__value">{stat.value}</div>
          {stat.note && <div className="stat__note">{stat.note}</div>}
        </div>
      ))}
    </div>
  );
}
