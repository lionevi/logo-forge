/** Bilan d'un export terminé : fichiers écrits, avertissements, échecs. */

import { summarizeReport } from '../core/exportOrchestrator'
import type { ExportReport, PlanIssue } from '../core/types'

interface ExportResultsProps {
  report: ExportReport
  /** Avertissements du plan, conservés après l'export. */
  warnings: PlanIssue[]
  onReveal: () => void
  /** Message affiché quand l'ouverture du dossier a échoué. */
  revealError: string | null
}

export function ExportResults({
  report,
  warnings,
  onReveal,
  revealError,
}: ExportResultsProps) {
  const succeeded = report.failures.length === 0 && !report.cancelled

  return (
    <section className="section" aria-labelledby="results-title">
      <h2 className="section-title" id="results-title">
        Résultats
      </h2>

      <div className={`card result-card${succeeded ? ' is-ok' : ''}`}>
        <p className="result-count">
          {report.written.length} fichier{report.written.length > 1 ? 's' : ''} créé
          {report.written.length > 1 ? 's' : ''}
        </p>
        <p className="result-meta">{summarizeReport(report)}</p>
      </div>

      {warnings.length > 0 && (
        <ul className="issues" aria-label="Avertissements">
          {warnings.map((issue) => (
            <li key={issue.code} className="issue is-warning">
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {report.failures.length > 0 && (
        <ul className="issues" aria-label="Erreurs">
          {report.failures.map((failure) => (
            <li key={failure.file.path} className="issue is-error">
              {failure.message}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="button is-secondary" onClick={onReveal}>
        Ouvrir le dossier
      </button>
      {revealError && <p className="hint is-warning">{revealError}</p>}
    </section>
  )
}
