// Shared formatting for edge annotations; kept separate from position comments.
const KifuBranches = (() => {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function lines(value, width = 13) {
    return String(value || '').split(/\r?\n/).flatMap(line => {
      const chars = Array.from(line), result = [];
      for (let i = 0; i < chars.length; i += width) result.push(chars.slice(i, i + width).join(''));
      return result.length ? result : [''];
    });
  }
  return { escape, lines };
})();
if (typeof module !== 'undefined') module.exports = KifuBranches;
