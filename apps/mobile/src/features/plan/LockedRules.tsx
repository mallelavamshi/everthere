/** The safety rules every avatar always follows. Shown on the plan so parents know they are on, and cannot be edited. */
export const LOCKED_RULES = ['Never promises pickup times', 'No secrets', 'Never scolds', 'No medical advice'] as const;

export function LockedRules() {
  return (
    <section aria-label="Always-on safety rules" className="rounded-card bg-lilac p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold leading-tight">
        <span aria-hidden="true" className="text-[18px]">
          🔒
        </span>
        Always on
      </h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px] leading-snug">
        {LOCKED_RULES.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-mintInk">
              ✓
            </span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] leading-snug text-mutedText">These stay on for every call, whatever you add above.</p>
    </section>
  );
}
