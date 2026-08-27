/**
 * Mise en place commune des tests.
 *
 * `@testing-library/jest-dom` ajoute les assertions de DOM (`toBeDisabled`,
 * `toBeInTheDocument`…). L'import est sans effet pour les tests qui tournent en
 * environnement Node.
 */

import '@testing-library/jest-dom/vitest'
