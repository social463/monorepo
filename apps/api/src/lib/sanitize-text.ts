/**
 * Remove tags HTML de texto colado em campos que são sempre tratados como
 * texto puro (nunca renderizados como HTML) — ver InovaProject.description e
 * afins, que viraram `<p>...</p>` cru na tela ao ser colado de um editor rico.
 */
export function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim()
}
