/** Document Illustrator actif : nom, plans de travail, et relecture manuelle. */

import type { ActiveDocumentInfo } from '../core/types'

interface DocumentSectionProps {
  document: ActiveDocumentInfo | null
  onRefresh: () => void
  disabled: boolean
}

export function DocumentSection({
  document,
  onRefresh,
  disabled,
}: DocumentSectionProps) {
  return (
    <section className="section" aria-labelledby="document-title">
      <div className="section-head">
        <h2 className="section-title" id="document-title">
          Document
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onRefresh}
          disabled={disabled}
          title="Re-détecter le document actif"
          aria-label="Re-détecter le document actif"
        >
          ↻
        </button>
      </div>

      {document ? (
        <div className="card">
          <p className="document-name" title={document.path || document.name}>
            {document.name}
          </p>
          <p className="document-meta">
            {document.artboardCount} plan{document.artboardCount > 1 ? 's' : ''} de
            travail
          </p>
        </div>
      ) : (
        <div className="card is-empty">
          <p className="document-name">Aucun document ouvert</p>
          <p className="document-meta">
            Ouvrez le logo à exporter dans Illustrator, puis actualisez.
          </p>
        </div>
      )}
    </section>
  )
}
