/**
 * TAV-71: shared page header — kicker + large gradient title + sub —
 * mirroring the landing page's stop headings. `actions` renders on the
 * right (count pills, buttons).
 */

export function PageHead({
  kicker,
  title,
  sub,
  actions,
}: {
  kicker: string;
  /** Title text; wrap part in <span className="grad-text">…</span> for the gradient. */
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Right-aligned actions (count pill, buttons). */
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions}
    </div>
  );
}
