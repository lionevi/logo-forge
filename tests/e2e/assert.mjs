/**
 * Vérifications d'un scénario.
 *
 * Un scénario qui se contenterait d'afficher son déroulé ne prouverait rien :
 * chaque étape affirme ce qu'elle attend, et l'écart est signalé avec ce qui a
 * réellement été observé.
 */

export class Scenario {
  constructor(title) {
    this.title = title
    this.checks = []
  }

  /** Vérifie une condition, en gardant la valeur observée. */
  ok(label, condition, observed) {
    this.checks.push({
      label: label,
      passed: !!condition,
      observed: observed === undefined ? '' : String(observed),
    })
  }

  equal(label, actual, expected) {
    this.ok(label, actual === expected, actual + ' (attendu : ' + expected + ')')
  }

  contains(label, haystack, needle) {
    this.ok(
      label,
      String(haystack).indexOf(needle) >= 0,
      'cherché « ' + needle + ' » dans « ' + String(haystack).slice(0, 160) + ' »',
    )
  }

  get failures() {
    return this.checks.filter((check) => !check.passed)
  }

  report() {
    const lines = ['', this.title]
    for (const check of this.checks) {
      lines.push(
        '  ' +
          (check.passed ? '[ok]  ' : '[ECHEC] ') +
          check.label +
          (check.passed ? '' : ' — ' + check.observed),
      )
    }
    return lines.join('\n')
  }
}
