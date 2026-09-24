/* Presentation-only explanatory drawings. No astronomy or application simulation. */
document.querySelectorAll('[data-scene]').forEach((element) => {
  const variant = element.dataset.scene;
  const wrong = variant === 'wrong';
  const shadow = wrong ? 'M250 244L99 259L155 279L302 262Z' : 'M250 244L417 269L365 291L246 262Z';
  element.innerHTML = `<svg viewBox="0 0 500 340" aria-hidden="true">
    <path d="M35 237L248 151L474 241L259 330Z" fill="#1c2b32" stroke="#3b4b54"/>
    <g stroke="#34454f" stroke-width="1"><path d="M75 219L297 313M117 202L340 296M161 186L384 278M205 168L428 261M78 255L293 169M122 273L336 186M166 291L379 204M211 310L425 222"/></g>
    <path d="${shadow}" fill="${wrong ? '#a46e69' : '#070d10'}" opacity="${wrong ? '.5' : '.85'}"/>
    <path d="M246 172L303 193L248 217L192 193Z" fill="#e9c58b"/>
    <path d="M192 193L248 217L248 271L192 244Z" fill="${wrong ? '#747e7e' : '#c29457'}"/>
    <path d="M248 217L303 193L303 246L248 271Z" fill="${wrong ? '#d9bc90' : '#6d7a7a'}"/>
    <path d="M95 91L185 180" stroke="#efbc6c" stroke-width="2" stroke-dasharray="5 7" opacity=".65"/>
    <circle cx="83" cy="77" r="23" fill="#efbc6c"/>
    <g stroke="#efbc6c" stroke-width="2"><path d="M83 38V28M83 126V116M44 77H34M132 77H122M55 49L48 42M111 105L118 112M55 105L48 112M111 49L118 42"/></g>
    ${variant === 'hero' ? '<path d="M157 169V149H177M319 169V149H299M157 266V286H177M319 266V286H299" fill="none" stroke="#8cbcd4" stroke-width="2"/><text x="341" y="201" fill="#9eb4bf" font-size="13" font-family="Segoe UI,sans-serif" letter-spacing="2">VIRTUAL</text>' : ''}
  </svg>`;
});
Reveal.initialize({
  width: 1280, height: 720, margin: 0.035, minScale: 0.15, maxScale: 2,
  hash: true, center: false, controls: true, controlsTutorial: false,
  progress: true, slideNumber: 'c/t', transition: 'fade', transitionSpeed: 'default', backgroundTransition: 'fade',
  keyboard: true, overview: true, touch: true, autoSlide: 0, totalTime: 880,
  plugins: [RevealNotes]
});
