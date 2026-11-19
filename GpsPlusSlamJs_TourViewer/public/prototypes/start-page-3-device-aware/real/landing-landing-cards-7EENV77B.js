/* eslint-disable */
/* A generated copy of the Tour Viewer's real landing modules (see ../README.md). Do not edit. */
import{a as O,b as U,c as j}from"./landing-chunk-5F6NOV2H.js";import"./landing-chunk-EVIYJKLO.js";var le=.9,ce=300,oe=2e3,B=.001,E={phase:"still",paused:!1,run:0};function D(l){let s=[...l.durationsMs];if(s.length===0||!s.every(t=>Number.isFinite(t)&&t>0))throw new Error("card-play: every card needs a positive, finite duration in ms");let{timer:r,render:c,reducedMotion:d}=l,x=l.startShare??le,w=l.settleMs??ce,v=l.holdMs??oe,M=s.length,b=Array.from({length:M},()=>E),C=Array.from({length:M},()=>0),y=Array.from({length:M},()=>0),p=null,k=null,A=!1,i=!1,a=null,u=0,n=null,e=t=>Number.isInteger(t)&&t>=0&&t<M;function o(t,f){let T=b[t]??E;T.phase===f.phase&&T.paused===f.paused&&T.run===f.run||(b[t]=f,c(t,f))}function g(){let t=null,f=-1;return C.forEach((T,G)=>{if(T<x-B)return;let te=Math.abs(T-f)<=B;(t===null||T>f+B||te&&G===p)&&(t=G,f=T)}),t}function m(){if(A||d)return null;let t=g();return t===null||(b[t]??E).paused?null:t}function S(){a!==null&&r.clear(a),a=null}function L(){n!==null&&r.clear(n.id),n=null}function V(t,f){S(),u=r.now()+f,a=r.set(()=>{a=null,$(t)},f)}function P(t){let f=b[t]??E;p=t,o(t,{phase:"playing",paused:!1,run:f.run+1}),V(t,s[t]??1)}function q(){if(p===null)return;let t=p;S(),p=null,k===t&&(k=null);let f=b[t]??E;o(t,{...f,phase:"still"})}function $(t){if(p!==t)return;let f=b[t]??E;if(f.phase==="holding"){P(t);return}if(k===t&&(k=null,m()!==t)){q(),H();return}o(t,{...f,phase:"holding"}),V(t,v)}function H(){if(i)return;if(k!==null){L();return}let t=m();if(p!==null&&p!==t&&q(),t===null||t===p){L();return}n?.index!==t&&(L(),n={index:t,id:r.set(()=>{n=null,k===null&&p===null&&m()===t?P(t):H()},w)})}function Z(t){let f=b[t]??E;p===t&&(y[t]=Math.max(0,u-r.now()),S(),p=null,k===t&&(k=null)),n?.index===t&&L(),o(t,{...f,paused:!0})}function ee(t){let f=b[t]??E,T=f.phase!=="still",G=!A&&!d&&g()===t;if(T&&G&&p===null&&k===null){L(),p=t,o(t,{...f,paused:!1}),V(t,y[t]??0);return}o(t,{...f,phase:"still",paused:!1}),H()}return{seen(t,f){i||!e(t)||(C[t]=O(f),H())},tap(t){i||!e(t)||((b[t]??E).paused?ee(t):Z(t),H())},showAgain(t){i||!e(t)||(L(),p!==null&&p!==t&&q(),S(),k=t,P(t))},setBlocked(t){i||(A=t,H())},state(t){return e(t)?b[t]??E:E},destroy(){i=!0,S(),L()}}}var Y=`<linearGradient id="lc-gSky" x1="0" y1="-250" x2="0" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#86abc6"/><stop offset=".5" stop-color="#b9cfdc"/><stop offset=".86" stop-color="#e9e3d2"/><stop offset="1" stop-color="#f2e0bf"/>
    </linearGradient>
    <radialGradient id="lc-gSun" cx="980" cy="40" r="640" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff7de" stop-opacity=".95"/><stop offset=".35" stop-color="#fff1cf" stop-opacity=".42"/><stop offset="1" stop-color="#fff1cf" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lc-gCloud"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="lc-gFacade" x1="330" y1="0" x2="690" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a69176"/><stop offset=".55" stop-color="#c6b292"/><stop offset="1" stop-color="#dac8a5"/>
    </linearGradient>
    <linearGradient id="lc-gFacadeV" x1="0" y1="118" x2="0" y2="474" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2e2214" stop-opacity=".1"/><stop offset=".33" stop-color="#2e2214" stop-opacity=".34"/><stop offset=".42" stop-color="#2e2214" stop-opacity="0"/><stop offset=".86" stop-color="#2e2214" stop-opacity="0"/><stop offset="1" stop-color="#2e2214" stop-opacity=".28"/>
    </linearGradient>
    <linearGradient id="lc-gRoof" x1="0" y1="96" x2="0" y2="244" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5c5a60"/><stop offset="1" stop-color="#3b3a40"/></linearGradient>
    <linearGradient id="lc-gGrass" x1="0" y1="466" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#b3ba84"/><stop offset=".3" stop-color="#97a764"/><stop offset="1" stop-color="#6a8044"/>
    </linearGradient>
    <linearGradient id="lc-gPath" x1="0" y1="470" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e3d8be"/><stop offset=".45" stop-color="#d3c19e"/><stop offset="1" stop-color="#c0a983"/>
    </linearGradient>
    <linearGradient id="lc-gWin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#55606a"/><stop offset=".45" stop-color="#2c3237"/><stop offset="1" stop-color="#3c444b"/></linearGradient>
    <linearGradient id="lc-gWood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f3a28"/><stop offset="1" stop-color="#6e5238"/></linearGradient>
    <radialGradient id="lc-gShadow"><stop offset="0" stop-color="#26301a" stop-opacity=".42"/><stop offset="1" stop-color="#26301a" stop-opacity="0"/></radialGradient>
    <clipPath id="lc-cFacade"><path d="M330 474 V232 L510 118 L690 232 V474 Z"/></clipPath>
    <pattern id="lc-pStone" width="34" height="17" patternUnits="userSpaceOnUse"><path d="M0 16.5H34M0 8H34M9 0V8M26 8V17" stroke="#4e3c28" stroke-opacity=".2" stroke-width="1" fill="none"/></pattern>
    <pattern id="lc-pGravel" width="16" height="13" patternUnits="userSpaceOnUse"><g fill="#8b7756" fill-opacity=".35"><circle cx="2" cy="3" r="1"/><circle cx="9" cy="1.5" r=".8"/><circle cx="13" cy="8" r="1.1"/><circle cx="5" cy="10" r=".7"/></g><g fill="#fff" fill-opacity=".35"><circle cx="6" cy="5" r=".8"/><circle cx="12" cy="12" r=".7"/></g></pattern>
    <symbol id="lc-qrSym" viewBox="-2 -2 25 25"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><path id="lc-qrPath" fill="#2a2824" fill-rule="evenodd"/></symbol>
    <g id="lc-poster">
      <rect x="838" y="480" width="48" height="66" fill="#fffdf6"/>
      <rect x="838" y="480" width="48" height="10" fill="#cf4428"/>
      <use href="#lc-qrSym" x="843" y="494" width="38" height="38"/>
      <rect x="844" y="538" width="36" height="3" fill="#3a3630" opacity=".55"/>
      <circle cx="841" cy="483" r="1.6" fill="#333"/><circle cx="883" cy="483" r="1.6" fill="#333"/>
    </g>
    <g id="lc-scene">
      <rect x="-600" y="-500" width="2400" height="980" fill="url(#lc-gSky)"/>
      <rect x="-600" y="-500" width="2400" height="980" fill="url(#lc-gSun)"/>
      <g>
        <ellipse cx="180" cy="30" rx="190" ry="24" fill="url(#lc-gCloud)"/>
        <ellipse cx="330" cy="62" rx="120" ry="15" fill="url(#lc-gCloud)" opacity=".7"/>
        <ellipse cx="760" cy="10" rx="220" ry="26" fill="url(#lc-gCloud)" opacity=".8"/>
        <ellipse cx="1180" cy="70" rx="160" ry="18" fill="url(#lc-gCloud)" opacity=".7"/>
      </g>
      <path d="M-600 446 C -300 410 -60 426 160 414 S 620 392 860 410 S 1300 396 1800 418 V 520 H -600 Z" fill="#b6c3ae"/>
      <g id="lc-farTrees"></g>
      <g>
        <rect x="836" y="300" width="18" height="182" fill="#5a4a3a"/>
        <g class="lc-canopy" data-c="870,232,150,128"><ellipse cx="870" cy="236" rx="140" ry="118" fill="#5d7342"/></g>
      </g>
      <g>
        <path d="M330 474 V232 L510 118 L690 232 V474 Z" fill="url(#lc-gFacade)"/>
        <g id="lc-stones" clip-path="url(#lc-cFacade)"></g>
        <path d="M330 474 V232 L510 118 L690 232 V474 Z" fill="url(#lc-pStone)"/>
        <path d="M330 474 V232 L510 118 L690 232 V474 Z" fill="url(#lc-gFacadeV)"/>
        <path d="M312 246 L510 106 L708 246" fill="none" stroke="url(#lc-gRoof)" stroke-width="20" stroke-linejoin="miter"/>
        <path d="M318 252 L510 116 L702 252" fill="none" stroke="#2a2420" stroke-opacity=".25" stroke-width="4"/>
        <rect x="684" y="236" width="6" height="238" fill="#efe1c0" opacity=".55"/>
        <circle cx="510" cy="192" r="21" fill="url(#lc-gWin)" stroke="#ece4d2" stroke-width="5"/>
        <path d="M489 192 H531 M510 171 V213" stroke="#ece4d2" stroke-width="2.4"/>
        <rect x="500" y="134" width="20" height="10" fill="#4a3a2a"/>
        <g stroke="#ede6d4" stroke-width="4" fill="url(#lc-gWin)">
          <rect x="352" y="292" width="40" height="52"/><rect x="420" y="292" width="40" height="52"/>
          <rect x="562" y="292" width="40" height="52"/><rect x="628" y="292" width="40" height="52"/>
          <rect x="352" y="380" width="40" height="52"/><rect x="628" y="380" width="40" height="52"/>
        </g>
        <path d="M372 292 V344 M352 318 H392 M440 292 V344 M420 318 H460 M582 292 V344 M562 318 H602 M648 292 V344 M628 318 H668 M372 380 V432 M352 406 H392 M648 380 V432 M628 406 H668" stroke="#ede6d4" stroke-width="2"/>
        <g fill="#fff" opacity=".18"><path d="M354 294 L376 294 L354 320 Z"/><path d="M564 294 L586 294 L564 320 Z"/><path d="M630 294 L652 294 L630 320 Z"/></g>
        <path d="M474 474 V404 A36 36 0 0 1 546 404 V474 Z" fill="#8f7c62"/>
        <path d="M480 474 V406 A30 30 0 0 1 540 406 V474 Z" fill="url(#lc-gWood)"/>
        <path d="M510 376 V474 M492 384 V474 M528 384 V474" stroke="#3b2b1d" stroke-width="1.4"/>
        <circle cx="504" cy="438" r="2.4" fill="#c9b27a"/><circle cx="516" cy="438" r="2.4" fill="#c9b27a"/>
        <rect x="326" y="456" width="368" height="20" fill="#8d7b61"/>
        <rect x="326" y="456" width="368" height="3" fill="#000" opacity=".12"/>
        <g fill="#566c37"><circle cx="336" cy="452" r="12"/><circle cx="346" cy="436" r="10"/><circle cx="338" cy="418" r="9"/><circle cx="350" cy="404" r="7"/><circle cx="341" cy="392" r="6"/><circle cx="356" cy="458" r="10"/></g>
        <g fill="#7f9852"><circle cx="340" cy="446" r="5"/><circle cx="350" cy="430" r="4"/><circle cx="344" cy="412" r="3.6"/></g>
        <ellipse cx="596" cy="478" rx="34" ry="6" fill="#1f2614" opacity=".28"/>
        <circle cx="594" cy="446" r="29" fill="#a3998a"/>
        <circle cx="594" cy="446" r="29" fill="none" stroke="#6f675b" stroke-width="2"/>
        <circle cx="594" cy="446" r="7" fill="#5f574b"/>
        <path d="M572 430 A28 28 0 0 1 612 424" fill="none" stroke="#d4cbbb" stroke-width="2" opacity=".7"/>
        <ellipse cx="680" cy="472" rx="30" ry="16" fill="#5c7539"/><ellipse cx="690" cy="466" rx="16" ry="9" fill="#7e9850"/>
      </g>
      <rect x="-600" y="466" width="2400" height="760" fill="url(#lc-gGrass)"/>
      <g id="lc-grassPatches"></g>
      <path d="M300 476 L720 476 L640 506 L230 520 Z" fill="#26301a" opacity=".16"/>
      <ellipse cx="840" cy="500" rx="190" ry="24" fill="url(#lc-gShadow)"/>
      <ellipse cx="190" cy="610" rx="250" ry="46" fill="url(#lc-gShadow)"/>
      <path d="M645 676 L1300 596 L1300 646 L700 770 Z" fill="url(#lc-gPath)"/>
      <path d="M485 472 L535 472 L833 1100 L188 1100 Z" fill="url(#lc-gPath)"/>
      <path d="M485 472 L535 472 L833 1100 L188 1100 Z M645 676 L1300 596 L1300 646 L700 770 Z" fill="url(#lc-pGravel)"/>
      <g id="lc-edgeStones"></g>
      <g id="lc-tufts"></g>
      <g>
        <path d="M150 600 C 158 520 170 430 168 330 L 196 330 C 196 430 196 520 206 600 Z" fill="#5d4a37"/>
        <path d="M188 600 C 192 520 194 430 192 340 L 196 330 C 197 430 198 520 206 600 Z" fill="#8a7357" opacity=".6"/>
        <g class="lc-canopy" data-c="160,250,180,160"><ellipse cx="160" cy="256" rx="168" ry="150" fill="#566d3b"/></g>
      </g>
      <g>
        <ellipse cx="350" cy="618" rx="56" ry="7" fill="#1f2614" opacity=".25"/>
        <rect x="300" y="586" width="100" height="7" rx="1.5" fill="#7a5b3c"/>
        <rect x="300" y="596" width="100" height="6" rx="1.5" fill="#6a4e33"/>
        <rect x="300" y="568" width="100" height="6" rx="1.5" fill="#7a5b3c"/>
        <g fill="#3c3530"><rect x="306" y="574" width="4" height="44"/><rect x="390" y="574" width="4" height="44"/></g>
      </g>
      <g>
        <ellipse cx="860" cy="664" rx="70" ry="9" fill="#1f2614" opacity=".25"/>
        <rect x="808" y="520" width="9" height="144" fill="#5a4330"/><rect x="903" y="520" width="9" height="144" fill="#5a4330"/>
        <path d="M786 470 L860 446 L934 470 Z" fill="#4c4a50"/>
        <rect x="794" y="468" width="132" height="94" rx="2" fill="#6e5136"/>
        <rect x="802" y="476" width="116" height="78" fill="#cdb791"/>
        <rect x="808" y="482" width="26" height="20" fill="#f3efe4" transform="rotate(-4 821 492)"/>
        <rect x="892" y="500" width="20" height="26" fill="#ece7dc" transform="rotate(5 902 513)"/>
      </g>
      <g id="lc-foreTufts"></g>
    </g>
    <g id="lc-millPhoto">
      <rect width="120" height="90" fill="#d8c19c"/>
      <rect width="120" height="44" fill="#e6d6b8"/>
      <path d="M28 76 V38 L60 18 L92 38 V76 Z" fill="#b59c74"/>
      <path d="M24 40 L60 15 L96 40" fill="none" stroke="#6b5538" stroke-width="3"/>
      <path d="M54 76 V62 A6 6 0 0 1 66 62 V76 Z" fill="#5d4a33"/>
      <g fill="#6f5a3c"><rect x="36" y="46" width="7" height="9"/><rect x="77" y="46" width="7" height="9"/><rect x="36" y="61" width="7" height="9"/><circle cx="60" cy="32" r="3.5"/></g>
      <rect x="0" y="76" width="120" height="14" fill="#c6ab82"/>
      <g fill="#4e3d29"><rect x="80" y="66" width="22" height="9" rx="1"/><circle cx="84" cy="77" r="4"/><circle cx="98" cy="77" r="4"/><path d="M102 70 h8 l3 -6 h3 v12 h-2 v-4 h-8 v4 h-2 Z"/><rect x="70" y="60" width="3" height="16"/><circle cx="71.5" cy="57.5" r="2.5"/><rect x="45" y="62" width="3" height="14"/><circle cx="46.5" cy="59.5" r="2.4"/></g>
      <rect width="120" height="90" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="6"/>
    </g>`,X=`<div class="lc-phone">
    <div class="lc-screen">
      <div class="lc-cam">
        <svg class="lc-world" preserveAspectRatio="xMidYMid slice">
          <use href="#lc-scene"/>
        </svg>
        <svg class="lc-world lc-ar" preserveAspectRatio="xMidYMid slice">
          <g class="lc-o lc-o-poster"><g class="lc-o-posterg"><use href="#lc-poster"/></g></g>
          <g class="lc-o lc-o-halo">
            <rect x="826" y="470" width="72" height="86" rx="6" fill="none" stroke="#fff" stroke-width="4" opacity=".95"/>
            <rect x="826" y="470" width="72" height="86" rx="6" fill="none" stroke="#cf4428" stroke-width="2"/>
          </g>
          <g class="lc-o lc-o-scan" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M822 486 V466 H842 M882 466 H902 V486 M902 540 V560 H882 M842 560 H822 V540" stroke="#fff" stroke-width="7"/>
            <path d="M822 486 V466 H842 M882 466 H902 V486 M902 540 V560 H882 M842 560 H822 V540" stroke="#2f7a4c" stroke-width="3.6"/>
          </g>
          <g class="lc-o lc-o-chevs" transform="translate(-30 4)">
            <path class="lc-o-chev" d="M592 731 L618 723 L604 712 L618 710 L640 722 L612 737 L602 737 Z" fill="#fff" fill-opacity=".97" stroke="#cf4428" stroke-width="2.4" stroke-linejoin="round"/>
            <path class="lc-o-chev" d="M646 717 L670 710 L657 700 L670 698 L690 708 L664 722 L655 722 Z" fill="#fff" fill-opacity=".93" stroke="#cf4428" stroke-width="2.2" stroke-linejoin="round"/>
            <path class="lc-o-chev" d="M695 704 L717 698 L705 689 L717 687 L735 696 L711 709 L703 709 Z" fill="#fff" fill-opacity=".88" stroke="#cf4428" stroke-width="2" stroke-linejoin="round"/>
          </g>
          <line class="lc-o lc-o-leader" x1="515" y1="592" x2="515" y2="616" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
          <ellipse class="lc-o lc-o-ripple" cx="515" cy="622" rx="44" ry="12" fill="none" stroke="#fff" stroke-width="3"/>
          <g class="lc-o lc-o-mk">
            <ellipse cx="515" cy="625" rx="50" ry="13" fill="#20160a" opacity=".22"/>
            <ellipse cx="515" cy="622" rx="44" ry="12" fill="#fff" fill-opacity=".9" stroke="#cf4428" stroke-width="4"/>
            <ellipse cx="515" cy="622" rx="28" ry="7.6" fill="#cf4428"/>
            <text x="515" y="622" transform="translate(0 622) scale(1 .42) translate(0 -622)" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="800" font-size="26" fill="#fff">1</text>
          </g>
          <g class="lc-o lc-o-retic">
            <ellipse cx="515" cy="622" rx="50" ry="13.5" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="2.6" stroke-dasharray="7 6"/>
            <path d="M459 622 h10 M561 622 h-10 M515 606 v6 M515 638 v-6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
            <circle cx="515" cy="622" r="3" fill="#fff"/>
          </g>
        </svg>
        <div class="lc-anchors">
          <div class="lc-anc lc-a-pic" data-wx="318" data-wy="226">
            <div class="lc-pic">
              <svg viewBox="0 0 120 90" aria-hidden="true"><use href="#lc-millPhoto"/></svg>
              <div class="lc-pcap">The mill, 1910</div>
            </div>
            <div class="lc-pic-ghost">+ Picture</div>
          </div>
          <div class="lc-anc lc-a-card" data-wx="515" data-wy="592">
            <div class="lc-tcard">
              <div class="lc-k">Text</div>
              <div class="lc-t"><span class="lc-ct" aria-hidden="true"><span class="lc-ch" style="--lc-i: 0">T</span><span class="lc-ch" style="--lc-i: 1">h</span><span class="lc-ch" style="--lc-i: 2">e</span><span class="lc-ch" style="--lc-i: 3">&#160;</span><span class="lc-ch" style="--lc-i: 4">o</span><span class="lc-ch" style="--lc-i: 5">l</span><span class="lc-ch" style="--lc-i: 6">d</span><span class="lc-ch" style="--lc-i: 7">&#160;</span><span class="lc-ch" style="--lc-i: 8">m</span><span class="lc-ch" style="--lc-i: 9">i</span><span class="lc-ch" style="--lc-i: 10">l</span><span class="lc-ch" style="--lc-i: 11">l</span></span><span class="lc-caret"></span></div>
              <div class="lc-b">Built in 1820. The stream still runs below.</div>
            </div>
          </div>
          <div class="lc-anc lc-a-next" data-wx="548" data-wy="752">
            <div class="lc-nextlbl"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#cf4428"/><path d="M6 10h7M10 6.5 13.5 10 10 13.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Next: the bridge</div>
          </div>
          <div class="lc-anc lc-a-found" data-wx="500" data-wy="596">
            <div class="lc-foundlbl"><i>1</i>The old mill</div>
          </div>
          <div class="lc-anc lc-a-callout" data-wx="862" data-wy="440">
            <div class="lc-callout"><b>Your tour's code</b>Hung where the walk begins.</div>
          </div>
        </div>
      </div>
      <div class="lc-grain"></div>
      <div class="lc-vignette"></div>
      <div class="lc-ui">
        <div class="lc-status"><span>10:24</span><span><svg viewBox="0 0 34 12"><path d="M0 9h3v3H0zM5 6h3v6H5zM10 3h3v9h-3zM15 0h3v12h-3z"/><rect x="21" y="1" width="11" height="10" rx="2" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="23" y="3" width="6.5" height="6" rx=".8"/></svg></span></div>
        <div class="lc-punch"></div>
        <div class="lc-hud">
          <span class="lc-hud-x"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg></span>
          <span class="lc-pill lc-p-visit">Mill Park<span class="lc-dots"><i class="lc-on"></i><i></i><i></i><i></i><i></i><i></i></span></span>
          <span class="lc-pill lc-p-make"><span class="lc-tag">Making</span>Station 1</span>
          <span class="lc-pill lc-p-saved"><span class="lc-tag lc-ok">Saved</span>6 stations</span>
        </div>
        <div class="lc-chip"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.3 2.3L9.5 3.5"/></svg>Tour found</div>
        <div class="lc-sheet lc-s-place">
          <p class="lc-hint">Stand where it happened</p>
          <span class="lc-sbtn">Place a pin</span>
        </div>
        <div class="lc-sheet lc-s-add">
          <div class="lc-tools">
            <span class="lc-tool lc-t-text"><svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></svg>Text</span>
            <span class="lc-tool lc-t-pic"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 3 2.5 3-3 5 4"/></svg>Picture</span>
          </div>
        </div>
        <div class="lc-sheet lc-s-share">
          <div class="lc-share-row"><svg class="lc-qr" viewBox="0 0 25 25" aria-hidden="true"><use href="#lc-qrSym" width="25" height="25"/></svg><div><b>Mill Park is ready</b><span>Print the code. Hang it where the walk begins.</span></div></div>
          <div class="lc-share-btns"><span class="lc-p">Print the code</span><span>Copy link</span></div>
        </div>
        <div class="lc-sheet lc-s-go">
          <p class="lc-hint"><b>Mill Park</b>6 stations. The first is just ahead.</p>
        </div>
      </div>
    </div>
  </div>`,ae="http://www.w3.org/2000/svg",h=l=>l.toFixed(1);function F(l,s,r,c){return`M${h(l-r)} ${h(s)}a${h(r)} ${h(c)} 0 1 0 ${h(2*r)} 0a${h(r)} ${h(c)} 0 1 0 ${h(-2*r)} 0z`}function I(l,s,r,c){return`M${h(l-c)} ${h(s)}q${h(c*.2)} ${h(-r*.6)} ${h(-c*.6)} ${h(-r)}M${h(l)} ${h(s)}q${h(c*.3)} ${h(-r*.6)} ${h(c*.1)} ${h(-r*1.15)}M${h(l+c)} ${h(s)}q${h(c*.1)} ${h(-r*.6)} ${h(c*.8)} ${h(-r*.9)}`}var ie=["#3c522d","#4d6636","#61793f","#7a934e","#97ad63","#b5c47e"],re=["#8c9e84","#9aab90","#a9b89e","#b6c3aa"],_=l=>485-297*(l-472)/628,W=l=>535+298*(l-472)/628;function K(l,s=20261025){let r="ownerDocument"in l&&l.ownerDocument!==null?l.ownerDocument:document,c=U(s),d=i=>l.querySelector(`#${i}`),x=(i,a)=>{let u=r.createElementNS(ae,"path");for(let[n,e]of Object.entries(a))u.setAttribute(n,e);i.appendChild(u)},w=i=>i!==null&&i.childElementCount===0,v=d("lc-qrPath");v!==null&&!v.hasAttribute("d")&&v.setAttribute("d",j());function M(i,a,u,n,e,o,g){let m=g.map(()=>"");for(let S=0;S<o;S++){let L=c()*Math.PI*2,V=Math.sqrt(c())*.9,P=a+Math.cos(L)*V*n,q=u+Math.sin(L)*V*e,$=n*(.13+c()*.16),H=.5+.55*((P-a)/n)*.5-.55*((q-u)/e)*.6+(c()-.5)*.45,Z=Math.max(0,Math.min(g.length-1,Math.round(H*(g.length-1))));m[Z]+=F(P,q,$,$)}m.forEach((S,L)=>{S!==""&&x(i,{d:S,fill:g[L]??"#61793f"})})}for(let i of Array.from(l.querySelectorAll(".lc-canopy"))){if(i.childElementCount>1)continue;let a=(i.getAttribute("data-c")??"").split(",").map(Number);a.length!==4||!a.every(Number.isFinite)||M(i,a[0]??0,a[1]??0,a[2]??1,a[3]??1,90,ie)}let b=d("lc-farTrees");if(w(b))for(let i=-600;i<1800;i+=40+c()*40){let a=22+c()*26;M(b,i,440-a*.4,a*1.1,a,9,re)}let C=d("lc-stones");if(w(C)){let i=[],a=[];for(let u=0,n=232;n<474;n+=17,u++)for(let e=330-u%2*17;e<690;e+=34){let o=c();o<.3?i.push(`M${String(e)} ${String(n)}h34v8.5h-34z`):o>.72&&a.push(`M${String(e+9)} ${String(n+8.5)}h17v8.5h-17z`)}x(C,{d:i.join(""),fill:"#3b2b18",opacity:".07"}),x(C,{d:a.join(""),fill:"#fff6e2",opacity:".13"})}let y=d("lc-grassPatches");if(w(y))for(let i of["#6f8546","#a6b277","#86995a"]){let a="";for(let u=0;u<26;u++){let n=480+Math.pow(c(),1.3)*560,e=(n-466)/534,o=-300+c()*1600,g=20+90*e*(.5+c()),m=g*(.12+.1*e);a+=F(o,n,g,m)}x(y,{d:a,fill:i,opacity:".32"})}let p=d("lc-edgeStones");if(w(p)){let i="";for(let a=0;a<70;a++){let n=474+Math.pow(a/70,1.5)*600,e=(n-466)/534,o=3+11*e,g=o*.45;for(let m of[_(n)+(c()-.5)*4*e,W(n)+(c()-.5)*4*e])i+=F(m,n,o,g)}x(p,{d:i,fill:"#b3a283",stroke:"#8a7a5d","stroke-width":".8"})}let k=d("lc-tufts");if(w(k)){let i="",a="";for(let n=0;n<260;n++){let e=478+Math.pow(c(),1.6)*560,o=-300+c()*1600,g=(e-466)/534;if(o>_(e)-8&&o<W(e)+8)continue;let m=I(o,e,4+16*g,1.5+4*g);c()<.55?i+=m:a+=m}let u={fill:"none","stroke-linecap":"round"};x(k,{...u,d:i,stroke:"#4f6532","stroke-width":"1.6",opacity:".75"}),x(k,{...u,d:a,stroke:"#c3cc8e","stroke-width":"1.3",opacity:".7"})}let A=d("lc-foreTufts");if(w(A)){let i="";for(let a=0;a<40;a++){let u=900+c()*160,n=c()<.5?120+c()*240:700+c()*300;i+=I(n,u,30+c()*30,6+c()*5)}x(A,{d:i,fill:"none",stroke:"#465c2c","stroke-width":"3","stroke-linecap":"round",opacity:".8"})}}var N="http://www.w3.org/2000/svg",R={place:2e3,add:3300,hang:2600,scan:2600},J=l=>l!==void 0&&Object.hasOwn(R,l);function ne(l,s,r){return!(s>0)||!(r>0)?0:O(l/Math.min(1,s/r))}var z={w:440,y0:250,y1:760},se=Array.from({length:21},(l,s)=>s/20),de=`<svg class="lc-scene-art" viewBox="270 70 500 600" preserveAspectRatio="xMidYMid slice"><use href="#lc-scene"/></svg>
<div class="lc-note">Built in 1820. The stream drove the wheel for a hundred years.</div>
<div class="lc-oldphoto"><svg viewBox="0 0 120 90"><use href="#lc-millPhoto"/></svg><span>The mill, 1910</span></div>`;function pe(l,s){let r=l.createElementNS(N,"svg");r.setAttribute("class","lc-back"),r.setAttribute("aria-hidden","true");let c=l.createElementNS(N,"use");c.setAttribute("href","#lc-scene");let d=l.createElementNS(N,"use");d.setAttribute("href","#lc-poster"),d.setAttribute("class","lc-bposter"),r.append(c,d);let x=l.createElement("div");x.className="lc-pale";let w=l.createElement("template");w.innerHTML=X,s.replaceChildren(r,x,w.content);let v=s.querySelector(".lc-phone"),M=s.querySelector(".lc-screen");if(v===null||M===null)return null;let b=Number(s.dataset.look);return{dock:s,look:Number.isFinite(b)?b:510,back:r,phone:v,screen:M,worlds:Array.from(s.querySelectorAll(".lc-world")),anchors:Array.from(s.querySelectorAll(".lc-anc"))}}function Q(l){let s=l.screen.clientWidth,r=l.screen.clientHeight;if(s===0||r===0)return;let c=z.w,d=z.w*r/s,x=l.look-c/2,w=z.y0-(d-(z.y1-z.y0))*.62,v=s/c,M=(...y)=>y.map(p=>p.toFixed(2)).join(" ");for(let y of l.worlds)y.setAttribute("viewBox",M(x,w,c,d));let b=l.phone.offsetLeft+l.screen.offsetLeft,C=l.phone.offsetTop+l.screen.offsetTop;l.back.setAttribute("viewBox",M(x-b/v,w-C/v,l.dock.clientWidth/v,l.dock.clientHeight/v));for(let y of l.anchors){let p=Number(y.dataset.wx),k=Number(y.dataset.wy);!Number.isFinite(p)||!Number.isFinite(k)||(y.style.left=`${((p-x)*v).toFixed(1)}px`,y.style.top=`${((k-w)*v).toFixed(1)}px`)}}function we(l,s){let r=l.ownerDocument,c=r.createElementNS(N,"svg");c.setAttribute("class","lc-defs"),c.setAttribute("aria-hidden","true"),c.setAttribute("focusable","false"),c.innerHTML=`<defs>${Y}</defs>`,l.before(c),K(c);for(let e of Array.from(l.querySelectorAll('.lc-dock[data-kind="scene"]')))e.innerHTML=de;let d=Array.from(l.querySelectorAll(".lc-dock[data-kind]")).filter(e=>J(e.dataset.kind)).map(e=>pe(r,e)).filter(e=>e!==null);for(let e of d)Q(e);let x=typeof ResizeObserver=="function"?new ResizeObserver(()=>{for(let e of d)Q(e)}):null;for(let e of d)x?.observe(e.dock);let w=e=>e.dock.closest(".landing-card"),v=d.map(e=>w(e)?.querySelector(".landing-hold")??null),M=d.map(e=>w(e)?.querySelector(".landing-again")??null),b=d.map(()=>0);function C(e,o){let g=d[e];if(g===void 0)return;let{dock:m}=g;o.phase==="still"?m.classList.remove("lc-play"):(o.run!==b[e]||!m.classList.contains("lc-play"))&&(m.classList.remove("lc-play"),m.offsetWidth,m.classList.add("lc-play")),b[e]=o.run,m.dataset.phase=o.phase,m.dataset.paused=String(o.paused),v[e]?.setAttribute("aria-pressed",String(o.paused))}let y=D({durationsMs:d.map(e=>{let o=e.dock.dataset.kind;return J(o)?R[o]:R.place}),reducedMotion:s.reducedMotion,timer:{now:()=>performance.now(),set:(e,o)=>window.setTimeout(e,o),clear:e=>{window.clearTimeout(e)}},render:C});for(let e of d)e.dock.dataset.phase="still",e.dock.dataset.paused="false";let p=[],k=(e,o,g)=>{e!==null&&(e.addEventListener(o,g),p.push(()=>{e.removeEventListener(o,g)}))};v.forEach((e,o)=>{e!==null&&(e.hidden=s.reducedMotion,k(e,"click",()=>{y.tap(o)}))}),M.forEach((e,o)=>{e!==null&&(e.dataset.ready="true"),k(e,"click",()=>{y.showAgain(o)})});let A=typeof IntersectionObserver=="function"?new IntersectionObserver(i,{threshold:se}):null;function i(e){for(let o of e){let g=d.findIndex(m=>m.dock===o.target);g<0||y.seen(g,o.isIntersecting?ne(o.intersectionRatio,window.innerHeight,o.boundingClientRect.height):0)}}for(let e of d)A?.observe(e.dock);let a=s.filmHost??null,u=()=>r.hidden||a?.dataset.playing==="true",n=new MutationObserver(()=>{y.setBlocked(u())});return a!==null&&n.observe(a,{attributes:!0,attributeFilter:["data-playing"]}),k(r,"visibilitychange",()=>{y.setBlocked(u())}),y.setBlocked(u()),l.dataset.landingCards="mounted",{destroy(){y.destroy(),A?.disconnect(),x?.disconnect(),n.disconnect();for(let e of p)e();for(let e of Array.from(l.querySelectorAll(".lc-dock[data-kind]")))e.replaceChildren(),e.classList.remove("lc-play"),delete e.dataset.phase,delete e.dataset.paused;for(let e of v)e!==null&&(e.hidden=!0);for(let e of M)e!==null&&delete e.dataset.ready;c.remove(),delete l.dataset.landingCards}}}export{R as CARD_DURATIONS_MS,we as mountLandingCards,ne as shareInView};
