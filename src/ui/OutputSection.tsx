/** Destination du pack : nom du package et dossier d'écriture. */

interface OutputSectionProps {
  packageName: string
  onPackageNameChange: (value: string) => void
  /** Chemin natif du dossier choisi, ou `null` tant qu'aucun ne l'est. */
  destination: string | null
  onChooseFolder: () => void
  disabled: boolean
}

/**
 * Tronque un chemin par le milieu, en gardant le début et la fin.
 *
 * Ce sont les deux extrémités qui identifient un dossier : le volume d'un côté,
 * le nom du dossier de l'autre.
 */
export function truncatePath(path: string, max = 44): string {
  if (path.length <= max) return path
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`
}

export function OutputSection({
  packageName,
  onPackageNameChange,
  destination,
  onChooseFolder,
  disabled,
}: OutputSectionProps) {
  return (
    <section className="section" aria-labelledby="output-title">
      <h2 className="section-title" id="output-title">
        Destination
      </h2>

      <label className="field">
        <span className="field-label">Nom du package</span>
        <input
          type="text"
          value={packageName}
          disabled={disabled}
          placeholder="mon-logo"
          onChange={(event) => onPackageNameChange(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="button is-secondary"
        onClick={onChooseFolder}
        disabled={disabled}
      >
        Choisir le dossier…
      </button>

      <p
        className={`destination${destination ? '' : ' is-empty'}`}
        title={destination ?? undefined}
      >
        {destination ? truncatePath(destination) : 'Aucun dossier choisi'}
      </p>
    </section>
  )
}
