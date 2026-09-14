import defaultThumbUrl from "../../../../assets/default-pet-thumbnail.png";
import { PetIcon } from "./teams-icons.js";
import type { TeamPetEntry } from "./teams-types.js";

export type TeamPetsSectionProps = {
  readonly pets: readonly TeamPetEntry[];
};

export function TeamPetsSection({ pets }: TeamPetsSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
            <PetIcon />
            <span>Team Pets</span>
            <span className="inline-flex items-center rounded-full bg-blue-100/60 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 text-[11px] font-bold text-brand">
              {pets.length}
            </span>
          </h3>
          <p className="m-0 mt-0.5 text-xs text-slatecopy">
            Company-curated companions installed from your organization’s Team Pack.
          </p>
        </div>
      </div>

      {pets.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200/80 bg-blue-50/20 dark:border-slate-800 dark:bg-slate-900/40 p-5 text-center text-xs text-slatecopy">
          <span>No team pets are currently deployed in your organization’s pack.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pets.map((pet: TeamPetEntry) => (
            <article
              key={pet.id}
              className="team-item-card flex items-center gap-3.5"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white to-blue-50 border border-blue-100 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                <img
                  src={`openpets-installed://spritesheet/${encodeURIComponent(pet.id)}`}
                  alt={pet.displayName}
                  className="h-10 w-10 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = defaultThumbUrl;
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 justify-between">
                  <strong className="text-sm font-bold text-navy dark:text-slate-100 truncate block">
                    {pet.displayName}
                  </strong>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-brand border border-blue-100/60 shrink-0 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300">
                    Team Managed
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slatecopy block truncate mt-0.5">
                  {pet.id}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
