/**
 * Hashtags a person meant as tags.
 *
 * `#\w+` also matches issue references — a synced GitHub PR body carrying
 * "#298" and "#5118" arrived as a row tagged with twenty numbers, which is
 * both noise and a filter nobody can use. Pure-numeric hashtags are left in
 * the content, where "#298" reads as the reference it is, and are not
 * extracted. Anything with a letter or underscore is still a tag.
 */
export function extractHashtags(content: string): { cleanContent: string; hashtags: string[] } {
  const isNumeric = (t: string) => /^\d+$/.test(t);
  const matches = content.match(/#\w+/g) ?? [];
  const hashtags = matches.map(t => t.slice(1).toLowerCase()).filter(t => !isNumeric(t));
  const cleanContent = content
    .replace(/#\w+/g, m => (isNumeric(m.slice(1)) ? m : ''))
    .replace(/\s+/g, ' ')
    .trim();
  return { cleanContent, hashtags };
}
