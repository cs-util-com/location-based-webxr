/**
 * The marks the tour Markdown long-body tests build their bodies from:
 * the block and inline marks of the accepted subset (not the code span's
 * backtick, the table's pipe, `<`, `&`, `~`, `^` or a setext `=`), a space,
 * a newline, a digit and two letters. One constant, so the property suite and the
 * linearity suite repeat chunks of the same alphabet.
 *
 * @see tour-markdown-chunks.ts.md
 */
export const TOUR_MARKDOWN_CHUNK_ALPHABET = '#*_-+>[]()!\\ \n.1az';
