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
  // Pointer events cover fingers, pens and mouse without preventing page scrolling.
  function attachPreview(button, comment, panel) {
    if (!comment || !panel) return { consumeClick: () => false };
    let contact = null, suppressClick = false, touchFocus = false;
    const show = () => { panel.textContent = comment; panel.hidden = false; };
    const hide = () => { panel.hidden = true; };
    button.classList.add('has-branch-comment');
    button.setAttribute('aria-describedby', panel.id);
    button.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse') { touchFocus = false; show(); }
    });
    button.addEventListener('pointerleave', () => {
      if (contact) { contact.moved = true; suppressClick = true; }
      hide();
    });
    button.addEventListener('focus', () => { if (!touchFocus) show(); });
    button.addEventListener('blur', hide);
    button.addEventListener('keydown', e => {
      if (e.key === 'Escape') hide();
      else { touchFocus = false; suppressClick = false; show(); }
    });
    button.addEventListener('pointerdown', e => {
      suppressClick = false;
      if (e.pointerType === 'mouse') { touchFocus = false; return; }
      if (e.isPrimary === false) return;
      touchFocus = true;
      contact = { id: e.pointerId, at: e.timeStamp, x: e.clientX, y: e.clientY, moved: false };
      show();
    });
    button.addEventListener('pointermove', e => {
      if (!contact || contact.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - contact.x, e.clientY - contact.y) > 10) {
        contact.moved = true; suppressClick = true; hide();
      }
    });
    button.addEventListener('pointerup', e => {
      if (!contact || contact.id !== e.pointerId) return;
      suppressClick = contact.moved || e.timeStamp - contact.at >= 350;
      contact = null;
      hide();
    });
    button.addEventListener('pointercancel', () => {
      contact = null; suppressClick = true; hide();
    });
    button.addEventListener('contextmenu', e => {
      if (touchFocus) { e.preventDefault(); suppressClick = true; }
    });
    return {
      consumeClick() {
        hide();
        const consumed = suppressClick;
        suppressClick = false;
        return consumed;
      }
    };
  }
  return { escape, lines, attachPreview };
})();
if (typeof module !== 'undefined') module.exports = KifuBranches;
