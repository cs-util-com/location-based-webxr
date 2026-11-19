/* eslint-disable */
/* A generated copy of the Tour Viewer's real landing modules (see ../README.md). Do not edit. */
import{a as Ti,c as $c}from"./landing-chunk-5F6NOV2H.js";import"./landing-chunk-EVIYJKLO.js";function Cd(i,e){if(!(Number.isInteger(i)&&i>0))throw new RangeError(`count must be a positive integer, got ${String(i)}`);if(!Number.isFinite(e))throw new RangeError(`p must be finite, got ${String(e)}`);let n=Math.min(1,Math.max(0,e))*i,s=Math.ceil(n-2*n*Number.EPSILON);return Math.min(i,Math.max(1,s))}function Xr(i,e){return i.length===0?Number.NaN:i[Cd(i.length,e)-1]}function Zc(i=300){if(!(Number.isInteger(i)&&i>0))throw new RangeError(`capacity must be a positive integer, got ${String(i)}`);let e=new Float64Array(i),t=0,n=0;return{push(s){Number.isFinite(s)&&s>=0&&(e[n]=s,n=(n+1)%i,t=Math.min(t+1,i))},summary(){if(t===0)return null;let s=e.slice(0,t).sort();return{p50:Xr(s,.5),p95:Xr(s,.95),p99:Xr(s,.99),max:s[t-1],count:t}}}}function Jc(i){let e=new URLSearchParams(i).get("debug")?.trim().toLowerCase();return e==="1"||e==="true"}function Kc(i,e,t){let n=e.length;if(n===0||t.length!==n)throw new RangeError(`film bar: need one title and one caption per part, got ${String(n)} and ${String(t.length)}`);let s=i.status==="finished",r=Math.min(n-1,Math.max(0,i.position.beat)),a=e.map((l,c)=>{let h=`Part ${String(c+1)} of ${String(n)}: ${l}`;if(s||c<r)return{index:c,look:"seen",fill:1,label:h,current:!1};if(c>r)return{index:c,look:"upcoming",fill:0,label:h,current:!1};let u=Math.min(1,Math.max(0,i.position.segmentProgress));return{index:c,look:"current",fill:u,label:h,current:!0}}),o=i.status==="playing"?{kind:"pause",label:"Pause the film"}:s&&!i.opening?{kind:"again",label:"Play again"}:{kind:"play",label:"Play the film"};return{segments:a,finished:s,paused:i.status==="paused",button:o,caption:t[s?n-1:r],captionsAsList:i.opening}}var jc={seen:"lf-seg-seen",current:"lf-seg-current",upcoming:"lf-seg-upcoming"},Pd={pause:'<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="1"/><rect x="8.5" y="1.5" width="3" height="11" rx="1"/></svg>',play:'<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.8v10.4L12 7z"/></svg>',again:'<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2.2a4.8 4.8 0 1 0 4.6 6.2l-1.7-.5A3 3 0 1 1 7 4V6l3.2-2.9L7 .2z"/></svg>'};function Qc(i,e){if(e.weights.length!==e.titles.length||e.titles.length===0)throw new RangeError(`film bar view: one weight per part, got ${String(e.weights.length)} for ${String(e.titles.length)}`);let t=i.createElement("div");t.className="lf-controls",t.setAttribute("role","group"),t.setAttribute("aria-label","The film's parts");let n=i.createElement("button");n.type="button",n.className="lf-play";let s=i.createElement("span");s.setAttribute("aria-hidden","true"),s.style.display="contents";let r=i.createElement("span");r.className="lf-play-text",r.setAttribute("aria-hidden","true"),n.append(s,r),n.addEventListener("click",()=>e.onToggle());let a=i.createElement("ol");a.className="lf-segs";let o=e.titles.map((h,u)=>{let d=i.createElement("li"),f=e.weights[u];d.style.flexGrow=String(Number.isFinite(f)&&f>0?f:1),d.style.flexBasis="0";let x=i.createElement("button");x.type="button",x.className="lf-seg lf-seg-upcoming";let b=i.createElement("span");b.className="lf-seg-track";let m=i.createElement("span");return m.className="lf-seg-fill",b.append(m),x.append(b),x.addEventListener("click",()=>e.onJump(u)),d.append(x),a.append(d),{b:x,fill:m,look:"upcoming",fillV:"",label:"",current:!1}});t.append(n,a);let l="",c="";return{element:t,update(h){h.segments.forEach((u,d)=>{let f=o[d];if(f===void 0)return;u.look!==f.look&&(f.b.classList.remove(jc[f.look]),f.b.classList.add(jc[u.look]),f.look=u.look);let x=u.fill.toFixed(4);x!==f.fillV&&(f.fill.style.setProperty("--lf-fill",x),f.fillV=x),u.label!==f.label&&(f.b.setAttribute("aria-label",u.label),f.label=u.label),u.current!==f.current&&(u.current?f.b.setAttribute("aria-current","step"):f.b.removeAttribute("aria-current"),f.current=u.current)}),h.button.kind!==l&&(l=h.button.kind,n.setAttribute("data-kind",l),s.innerHTML=Pd[h.button.kind]),h.button.label!==c&&(c=h.button.label,n.setAttribute("aria-label",c),r.textContent=c)}}}function ol(i){return i==="0"?!1:i==="1"?!0:null}function eh(i,e){let t=new URLSearchParams(i),n=t.get("film-dpr"),s=n===null||n===""?Number.NaN:Number(n);return{pixelRatioCap:Number.isFinite(s)&&s>0?Math.min(3,Math.max(.5,s)):e.pixelRatioCap,shadows:ol(t.get("film-shadows"))??e.shadows,eyePass:ol(t.get("film-eye"))??e.eyePass,antialias:ol(t.get("film-aa"))??e.antialias}}function th(){let i=0,e=0,t=0,n=0;return{push(s){Number.isFinite(s)&&s>=0&&(i+=1,s>33&&(e+=1),s>50&&(t+=1),s>100&&(n+=1))},counts:()=>({count:i,over33:e,over50:t,over100:n})}}var ll=i=>i.toFixed(1);function nh(i){let e=[i.renderer];if(i.renderer==="3d"){e.push(`dpr ${String(Math.round(i.dpr*100)/100)}`);let n=[i.quality.shadows?"shadows":"",i.quality.eyePass?"eye":"",i.quality.antialias?"aa":""].filter(s=>s!=="");n.length>0&&e.push(n.join(" "))}i.buildMs>0&&e.push(`build ${String(Math.round(i.buildMs))} ms`);let t=[e.join(", "),`${i.status} ${i.t.toFixed(1)} / ${i.totalS.toFixed(1)} s`];return i.live&&t.push(`p50 ${ll(i.live.p50)} p95 ${ll(i.live.p95)} max ${ll(i.live.max)} ms`),i.run.count>0&&t.push(`${String(i.run.count)} frames: ${String(i.run.over33)} over 33 ms, ${String(i.run.over50)} over 50, ${String(i.run.over100)} over 100`),t.join(`
`)}var ih='<rect width="120" height="90" fill="#d8c19c"/><rect width="120" height="44" fill="#e6d6b8"/><path d="M26 76 V40 L58 20 L90 40 V76 Z" fill="#b59c74"/><path d="M22 42 L58 17 L94 42" fill="none" stroke="#6b5538" stroke-width="3"/><circle cx="22" cy="60" r="14" fill="none" stroke="#5d4a33" stroke-width="2.6"/><path d="M22 46 V74 M8 60 H36 M12 50 L32 70 M32 50 L12 70" stroke="#5d4a33" stroke-width="1.2"/><g fill="#6f5a3c"><rect x="44" y="48" width="7" height="9"/><rect x="70" y="48" width="7" height="9"/><path d="M54 76 V64 A5 5 0 0 1 64 64 V76 Z"/></g><rect y="76" width="120" height="14" fill="#c6ab82"/>';function Id(i){return`
<svg class="lf-qr-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><symbol id="${i}" viewBox="-2 -2 25 25"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><path fill="#2a2824" fill-rule="evenodd" d="${$c()}"/></symbol></defs></svg>
<div class="lf-stage">
  <svg class="lf-layer lf-floor" role="img" aria-label="A small model park with a mill, a pond and trees. A dotted route links a code at the start with five numbered stations."></svg>
  <div class="lf-tags" aria-hidden="true"></div>
  <svg class="lf-layer lf-lead" aria-hidden="true"><line class="lf-lead-line" x1="0" y1="0" x2="0" y2="0" stroke="#2a2824" stroke-width="1.3" stroke-dasharray="4 4" opacity="0"/><circle class="lf-lead-dot" r="3" fill="#2a2824" opacity="0"/></svg>
  <figure class="lf-polaroid" aria-hidden="true"><svg viewBox="0 0 120 90">${ih}<rect width="120" height="90" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="6"/></svg><figcaption>The mill, 1910</figcaption></figure>
  <div class="lf-mphone" aria-hidden="true">
    <div class="lf-mscreen">
      <svg class="lf-still" data-still="mill" viewBox="0 0 100 190" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="190" fill="#dfe7e3"/>
        <path d="M-4 112 C 20 104 60 106 104 110 V190 H-4Z" fill="#d3cfa6"/>
        <path d="M0 118 C 18 116 28 122 40 119" stroke="#b8cbc3" stroke-width="5" fill="none"/>
        <rect x="54" y="80" width="52" height="34" fill="#efe7d4" stroke="#2a2824" stroke-width=".7"/>
        <path d="M50 82 L80 61 L110 82 Z" fill="#a49a86" stroke="#2a2824" stroke-width=".7"/>
        <rect x="62" y="90" width="7" height="9" fill="#6c665b"/><rect x="84" y="99" width="8" height="15" fill="#6c665b"/>
        <circle cx="47" cy="99" r="14" fill="none" stroke="#8f7457" stroke-width="2.4"/>
        <path d="M47 85 V113 M33 99 H61 M37 89 L57 109 M57 89 L37 109" stroke="#8f7457" stroke-width="1"/>
        <circle cx="12" cy="92" r="13" fill="#a7ae7c"/><path d="M12 105 V116" stroke="#8a735a" stroke-width="2.4"/>
        <path d="M22 118 L28 82 L34 118Z" fill="#8c9a6c"/>
        <path d="M30 190 L74 190 L50 116 L46 116 Z" fill="#f6f1e3"/>
        <circle cx="88" cy="128" r="9" fill="#a7ae7c"/><path d="M88 137 V146" stroke="#8a735a" stroke-width="2"/>
      </svg>
      <svg class="lf-still" data-still="poster" viewBox="0 0 100 190" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="190" fill="#dfe7e3"/>
        <path d="M-4 116 C 30 110 70 112 104 116 V190 H-4Z" fill="#d3cfa6"/>
        <circle cx="12" cy="96" r="15" fill="#a7ae7c"/><path d="M12 111 V122" stroke="#8a735a" stroke-width="2.4"/>
        <path d="M80 122 L88 80 L96 122Z" fill="#8c9a6c"/>
        <rect x="60" y="88" width="30" height="26" fill="#efe7d4" stroke="#2a2824" stroke-width=".6"/><path d="M57 90 L75 76 L93 90Z" fill="#b8a48a" stroke="#2a2824" stroke-width=".6"/>
        <path d="M14 190 L86 190 L58 118 L42 118 Z" fill="#f6f1e3"/>
      </svg>
      <div class="lf-ov">
        <div class="lf-anc" data-a="ret"><div class="lf-retic"><svg viewBox="0 0 100 30"><ellipse cx="50" cy="15" rx="44" ry="11" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="2.4" stroke-dasharray="7 6"/><path d="M2 15h8M98 15h-8M50 1v5M50 29v-5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="50" cy="15" r="2.6" fill="#fff"/></svg></div><div class="lf-ripple"></div></div>
        <div class="lf-anc lf-floor-only" data-a="pinf"><div class="lf-pinf"><svg viewBox="0 0 26 92"><ellipse cx="13" cy="89" rx="9" ry="2.6" fill="rgba(42,40,36,.25)"/><path d="M13 30 V88" stroke="#2a2824" stroke-width="1.6"/><path d="M13 32 L4 16 A 11 11 0 1 1 22 16 Z" fill="#cf4428"/><circle cx="13" cy="11" r="4.2" fill="#fff"/></svg></div></div>
        <div class="lf-anc lf-floor-only" data-a="posterf"><div class="lf-posterf"><svg viewBox="0 0 40 70" preserveAspectRatio="none"><rect x="18" y="40" width="4" height="30" fill="#a88c6c"/><rect x="0" y="0" width="40" height="46" fill="#fff" stroke="#2a2824" stroke-width="1"/><rect x="0" y="0" width="40" height="7" fill="#cf4428"/><use href="#${i}" x="8" y="12" width="24" height="24"/></svg></div></div>
        <div class="lf-anc" data-a="halo"><div class="lf-halo"></div><div class="lf-scanbox"><i></i><i></i><i></i><i></i></div></div>
        <div class="lf-anc" data-a="pic"><div class="lf-ghost">+ Picture</div><div class="lf-pic"><svg viewBox="0 0 120 90" aria-hidden="true">${ih}</svg><div class="lf-pcap">The mill, 1910</div></div></div>
        <div class="lf-anc" data-a="card"><div class="lf-tcard"><div class="lf-t"><span class="lf-ct">The old mill</span><span class="lf-caret"></span></div><div class="lf-b">Built in 1820. The stream still runs below.</div></div></div>
        <div class="lf-anc" data-a="call"><div class="lf-callout"><b>Your tour's code</b><span class="lf-callout-b">Hung where the walk begins.</span></div></div>
        <div class="lf-anc" data-a="next"><div class="lf-nextlbl"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#cf4428"/><path d="M6 10h7M10 6.5 13.5 10 10 13.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Next: the old oak</div></div>
      </div>
      <div class="lf-ui">
        <div class="lf-status"><span>10:24</span><span><svg viewBox="0 0 34 12"><path d="M0 9h3v3H0zM5 6h3v6H5zM10 3h3v9h-3zM15 0h3v12h-3z"/><rect x="21" y="1" width="11" height="10" rx="2" fill="none" stroke="#2a2824" stroke-width="1.4"/><rect x="23" y="3" width="6.5" height="6" rx=".8"/></svg></span></div>
        <div class="lf-hud"><span class="lf-hud-x"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg></span><span class="lf-pill"></span></div>
        <div class="lf-chip"><b>Tour found: Mill Park</b><span>Opened in the browser</span></div>
        <div class="lf-sheet" data-sheet="place"><p class="lf-hint2">Stand where it happened</p><span class="lf-sbtn" data-btn="place">Place a pin</span></div>
        <div class="lf-sheet" data-sheet="tools"><div class="lf-tools"><span class="lf-tool lf-sel" data-tool="text"><svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></svg>Text</span><span class="lf-tool" data-tool="pic"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 3 2.5 3-3 5 4"/></svg>Picture</span></div></div>
        <div class="lf-sheet" data-sheet="share"><div class="lf-share-row"><svg class="lf-qr" viewBox="0 0 25 25" aria-hidden="true"><use href="#${i}" width="25" height="25"/></svg><div><b>Mill Park is ready</b><span>Print its code. Hang it where the walk begins.</span></div></div><div class="lf-share-btns"><span class="lf-p" data-btn="print">Print the code</span><span>Copy link</span></div></div>
      </div>
      <div class="lf-cover"></div>
    </div>
  </div>
  <span class="lf-paused-mark" aria-hidden="true"></span>
  <span class="lf-debug" hidden></span>
</div>
<p class="lf-caption"></p>
<ol class="lf-captions" hidden></ol>`}function pt(i,e){let t=i.querySelector(e);if(!t)throw new Error(`film markup: missing ${e}`);return t}var sh=0;function rh(i){let e=i.createElement("div");e.className="lf-film",sh+=1,e.innerHTML=Id(`lf-qr-${String(sh)}`);let t=n=>pt(e,`.lf-anc[data-a="${n}"]`);return{root:e,stage:pt(e,".lf-stage"),floor:pt(e,".lf-floor"),tags:pt(e,".lf-tags"),leadLine:pt(e,".lf-lead-line"),leadDot:pt(e,".lf-lead-dot"),polaroid:pt(e,".lf-polaroid"),phone:pt(e,".lf-mphone"),screen:pt(e,".lf-mscreen"),caption:pt(e,".lf-caption"),captions:pt(e,".lf-captions"),debug:pt(e,".lf-debug"),parts:{cover:pt(e,".lf-cover"),pill:pt(e,".lf-pill"),chip:pt(e,".lf-chip"),place:pt(e,'[data-sheet="place"]'),tools:pt(e,'[data-sheet="tools"]'),share:pt(e,'[data-sheet="share"]'),placeBtn:pt(e,'[data-btn="place"]'),printBtn:pt(e,'[data-btn="print"]'),toolText:pt(e,'[data-tool="text"]'),toolPic:pt(e,'[data-tool="pic"]'),retic:pt(e,".lf-retic"),ripple:pt(e,".lf-ripple"),pinF:pt(e,".lf-pinf"),posterF:pt(e,".lf-posterf"),halo:pt(e,".lf-halo"),scan:pt(e,".lf-scanbox"),pic:pt(e,".lf-pic"),ghost:pt(e,".lf-ghost"),card:pt(e,".lf-tcard"),typed:pt(e,".lf-ct"),caret:pt(e,".lf-caret"),body:pt(e,".lf-tcard .lf-b"),callout:pt(e,".lf-callout"),next:pt(e,".lf-nextlbl"),stills:[...e.querySelectorAll(".lf-still")],anchors:{ret:t("ret"),pinf:t("pinf"),posterf:t("posterf"),halo:t("halo"),pic:t("pic"),card:t("card"),call:t("call"),next:t("next")}}}}var Us=Math.PI/180,Os=72,Yr=4;function Ld(i,e,t,n,s){let r=s*s,a=r*s,o=l=>.5*(2*e[l]+(-i[l]+t[l])*s+(2*i[l]-5*e[l]+4*t[l]-n[l])*r+(-i[l]+3*e[l]-3*t[l]+n[l])*a);return[o(0),o(1)]}function ch(i,e){let t=[],n=r=>i[Math.min(i.length-1,Math.max(0,r))];for(let r=0;r<i.length-1;r++)for(let a=0;a<e;a++)t.push(Ld(n(r-1),n(r),n(r+1),n(r+2),a/e));let s=i[i.length-1];return t.push([s[0],s[1]]),t}function Fd(i){let e=[0];for(let n=1;n<i.length;n++)e.push(e[n-1]+Math.hypot(i[n][0]-i[n-1][0],i[n][1]-i[n-1][1]));let t=e[e.length-1];return{pts:i,cum:e,len:t,at(n){let s=Math.min(t,Math.max(0,Number.isFinite(n)?n:0)),r=0,a=e.length-1;for(;a-r>1;){let x=r+a>>1;e[x]<=s?r=x:a=x}let o=e[a]-e[r]||1,l=(s-e[r])/o,c=i[r],h=i[a],u=h[0]-c[0],d=h[1]-c[1],f=Math.hypot(u,d)||1;return{x:c[0]+u*l,z:c[1]+d*l,tx:u/f,tz:d/f}},nearest(n,s){let r=0,a=1/0;return i.forEach((o,l)=>{let c=Math.hypot(o[0]-n,o[1]-s);c<a&&(a=c,r=e[l])}),r}}}var hh=12,Nd=[[-7.4,-5.3],[-10,-5.1],[-12,-4.4],[-12.3,-1],[-11.4,3],[-9.4,5.6],[-6.4,6.5],[-2.5,8.4],[2,8.5],[5,7],[9.5,7.4],[12.2,5],[11.6,1.6],[8,.2],[3.8,-1.4],[1,-3],[.4,-5],[2.8,-5.9],[6.5,-6.6],[10,-7.2],[12.8,-6]],Wt=Fd(ch(Nd,hh)),si=Wt.len,Dd=[{n:1,name:"Mill wheel",ctrl:2,pin:[-13.1,-6.3]},{n:2,name:"Old oak",ctrl:6,pin:[-5.2,5]},{n:3,name:"Pond",ctrl:9,pin:[5.3,5.2]},{n:4,name:"Fountain",ctrl:16,pin:[-1.4,-6]},{n:5,name:"Viewpoint",ctrl:20,pin:[14.4,-4.9]}],xn=Dd.map(i=>({...i,s:Wt.cum[i.ctrl*hh]})),Ud=[[-14.5,-13.9],[-14.2,-9],[-14.8,-3.5],[-14.1,2.5],[-14.9,8.5],[-14.5,13.9]],Mn=ch(Ud.map(i=>[i[1],i[0]]),8).map(i=>[i[1],i[0]]);function Od(i){for(let e=1;e<Mn.length;e++)if(Mn[e][1]>=i){let t=Mn[e-1],n=Mn[e],s=(i-t[1])/(n[1]-t[1]||1);return t[0]+(n[0]-t[0])*s}return Mn[Mn.length-1][0]}var lt={mill:[-11.95,1],poster:[-6.15,-1.6],scan:[-6.2,-2.6]},Pn={mill:[-13.1,1.61,-6.3],poster:[-6.2,1.72,-5.5],scan:[-6.2,1.64,-5.5]},uh={mill:{pos:[lt.mill[0],.68,lt.mill[1]],target:Pn.mill,fov:56},poster:{pos:[lt.poster[0],.68,lt.poster[1]],target:Pn.poster,fov:58},scan:{pos:[lt.scan[0],.68,lt.scan[1]],target:Pn.scan,fov:50}},$i=Wt.nearest(lt.mill[0],lt.mill[1]),Gn=Wt.at(0),Zi=Math.hypot(Gn.x-lt.scan[0],Gn.z-lt.scan[1]),at={slab:{w:36,d:28,r:2.6,grass:.3,earth:.9},mill:{x0:-12.6,x1:-6.2,z0:-11.6,z1:-6.8,h:2.6,roof:1.7},barn:{x0:6.6,x1:11.2,z0:-13,z1:-10.2,h:2,roof:1.3},yard:{x0:-3.6,x1:4.6,z0:-10.4,z1:-4},fountain:{x:.2,z:-7.4},pond:{x:6.6,z:3.6,rx:3.3,rz:2},oak:{x:-3.4,z:2.6,r:2.1,h:2.4},lookout:{x:14.3,z:-5.6,s:2.6,h:.45},poster:{x:-6.2,z:-5.6},wheel:{x:-12.95,z:-9.2,y:1.15,r:1.45,w:.45},streamW:2.2,pathW:.9,pinH:2.2,eyePinH:1.3,colors:{grass:"#d3cfa6",grassSide:"#bdb68c",earth:"#b59f7e",path:"#f6f1e3",water:"#b8cbc3",waterLine:"#e3ece6",wall:"#efe7d4",roof:"#a49a86",roof2:"#b8a48a",dark:"#6c665b",paving:"#e7dfc9",tree:"#a7ae7c",conifer:"#8c9a6c",trunk:"#8a735a",ink:"#2a2824",paper:"#f4eedf",route:"#cf4428",stone:"#d8cfba",wood:"#a88c6c",sky:"#dfe7e3"}},Ji=(()=>{let i=(Os-55)*Us,e=Math.sqrt(1-.82*.82);return[Math.sin(i)*e,.82,Math.cos(i)*e]})(),ah=Math.sin(Os*Us),oh=Math.cos(Os*Us),Bd=Math.sin(Yr*Us),zd=Math.cos(Yr*Us),qr=at.mill,Bs={mill:[[-13.1,at.pinH+1,-6.3],[-13.1,0,-6.3],[-13.4,2.8,-9.2],[-12.6,qr.h+qr.roof,-9.2],[-9.6,qr.h+qr.roof,-9.2],[lt.mill[0],1.9,lt.mill[1]],[lt.mill[0],0,lt.mill[1]+.8],[-14.2,0,-2.5],[-10.4,0,-2.5]],poster:[[-6.2,2.7,-5.6],[-6.2,0,-5.6],[Gn.x,0,Gn.z],[lt.poster[0],1.9,lt.poster[1]],[lt.poster[0],0,lt.poster[1]+.7],[lt.scan[0],0,lt.scan[1]],[-10.4,0,-4.4],[-2.2,0,-4.4],[-6.2,0,-7.6],[-6.2,0,.6]]};function lh(i,e,t,n){let s=n[0]-t[0],r=n[1]-t[1],a=s*s+r*r||1,o=Ti(((i-t[0])*s+(e-t[1])*r)/a);return Math.hypot(i-t[0]-o*s,e-t[1]-o*r)}var ri=(()=>{let i=7,e=()=>(i=i*16807%2147483647,(i-1)/2147483646),t=(l,c,h,u)=>c>l.x0-u&&c<l.x1+u&&h>l.z0-u&&h<l.z1+u,n=(l,c,h)=>{for(let u=0;u<Wt.pts.length;u+=2){let d=Wt.pts[u];if(Math.hypot(d[0]-l,d[1]-c)<h)return!0}return!1},s=[[lt.mill,[-13.1,-6.3]],[lt.mill,[-13,-9.2]],[lt.poster,[-6.2,-5.6]],[lt.scan,[-6.2,-5.6]]],r=[lt.mill,lt.poster,lt.scan,[-13.1,-6.3],[-6.2,-5.6],[-13,-9.2]].map(l=>[l,[l[0]+Bd*4.4,l[1]+zd*4.4]]),a=at,o=[];for(let l=-16.5;l<=16.5;l+=2.4)for(let c=-12.6;c<=12.6;c+=2.4){let h=l+(e()-.5)*1.8,u=c+(e()-.5)*1.8,d=e()<.32?1:0,f=.78+e()*.42;Math.abs(h)>16.9||Math.abs(u)>12.9||Math.abs(h)>15.4&&Math.abs(u)>10.4||n(h,u,1.7)||n(h-ah*1.9,u-oh*1.9,1.55)||t(a.mill,h,u,1)||t(a.barn,h,u,.9)||t(a.yard,h,u,.6)||h<-12.6&&u>-11&&u<-7.5||Math.abs(h-Od(u))<2.1||((h-a.pond.x)/(a.pond.rx+1))**2+((u-a.pond.z)/(a.pond.rz+1))**2<1||Math.hypot(h-a.oak.x,u-a.oak.z)<3.2||Math.hypot(h-a.lookout.x,u-a.lookout.z)<2.6||Math.hypot(h-a.poster.x,u-a.poster.z)<1.6||xn.some(b=>Math.hypot(h-b.pin[0],u-b.pin[1])<1.6||Math.hypot(h-ah*2.2-b.pin[0],u-oh*2.2-b.pin[1])<2)||s.some(b=>lh(h,u,b[0],b[1])<1.9)||r.some(b=>lh(h,u,b[0],b[1])<1.8)||h>-7.2&&h<0&&u>-4.2&&u<2.6||o.push({x:h,z:u,kind:d,s:f})}return o})();var kd=.47,dh=1.83,fh=52,ph=[400,470],$r=Math.PI/180,cl=i=>Number.isFinite(i)&&i>=1?i:1;function mh(i,e,t){let n=cl(i),s=cl(e),r=n/s<1.05&&cl(t)<700,a=r?n*kd:Math.min(n*.4,290),o=a*dh;o>s-fh&&(o=Math.max(1,s-fh),a=o/dh);let l=r?12:Math.max(14,n*.04),c=Math.round(n-a-l),h=Math.round((s-o)/2);a=Math.round(a),o=Math.round(o);let u=Math.min(a*.95,190);return{W:n,H:s,portrait:r,phone:{x:c,y:h,w:a,h:o},screen:{x:c+9,y:h+9,w:a-18,h:o-18},free:{x0:40,x1:Math.max(90,c-14),y0:26,y1:s-10},polaroid:{x:Math.round(c+(a-u)/2),y:Math.round(h+o*.24),w:u}}}function hl(i){let e=i.free,t=Math.min(e.x1-e.x0,ph[0]),n=Math.min(e.y1-e.y0,ph[1]),s=(e.x0+e.x1)/2,r=(e.y0+e.y1)/2;return{x0:s-t/2,x1:s+t/2,y0:r-n/2,y1:r+n/2}}function Zr(i,e){if(i==="over")return[-.91,.91,-.9,.86];let t=hl(e);return[t.x0/e.W*2-1,t.x1/e.W*2-1,1-t.y1/e.H*2,1-t.y0/e.H*2]}function Ki(i,e){return i==="over"?{az:Os*$r,el:(e.W/e.H<1.2?56:40)*$r,fov:15}:{az:Yr*$r,el:40*$r,fov:18}}var xh=Math.PI/180,Qe=at.colors;function Vd(i){return[Number.parseInt(i.slice(1,3),16),Number.parseInt(i.slice(3,5),16),Number.parseInt(i.slice(5,7),16)]}function ul(i,e){return`rgb(${Vd(i).map(t=>Math.min(255,Math.max(0,Math.round(t*e)))).join(",")})`}function gh(i){let e=[...i].sort((r,a)=>r[0]-a[0]||r[1]-a[1]),t=(r,a,o)=>(a[0]-r[0])*(o[1]-r[1])-(a[1]-r[1])*(o[0]-r[0]),n=[],s=[];for(let r of e){for(;n.length>=2&&t(n[n.length-2],n[n.length-1],r)<=0;)n.pop();n.push(r)}for(let r=e.length-1;r>=0;r--){let a=e[r];for(;s.length>=2&&t(s[s.length-2],s[s.length-1],a)<=0;)s.pop();s.push(a)}return s.pop(),n.pop(),n.concat(s)}function Hd(i,e,t,n){let s=i/2-n,r=e/2-n,a=t-n,o=[];for(let l of[[s-a,r-a,0],[-(s-a),r-a,90],[-(s-a),-(r-a),180],[s-a,-(r-a),270]])for(let c=0;c<=6;c++){let h=(l[2]+c*15)*xh;o.push([l[0]+Math.cos(h)*a,l[1]+Math.sin(h)*a])}return o}var zs=(()=>{let i=(1+Math.sqrt(5))/2;return{v:[[-1,i,0],[1,i,0],[-1,-i,0],[1,-i,0],[0,-1,i],[0,1,i],[0,-1,-i],[0,1,-i],[i,0,-1],[i,0,1],[-i,0,-1],[-i,0,1]].map(n=>{let s=Math.hypot(n[0],n[1],n[2]);return[n[0]/s,n[1]/s,n[2]/s]}),f:[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]}})();function _h(i,e,t){let n=i.view,s=Ki(n,t),r=Math.cos(s.az),a=Math.sin(s.az),o=Math.cos(s.el),l=Math.sin(s.el),c=[a*o,l,r*o],h=Ji,u=1e9,d=1e9,f=-1e9,x=-1e9,b=(L,T,j,ue=!0)=>{let M=L*r-j*a,g=l*a*L-o*T+l*r*j;return ue&&(u=Math.min(u,M),f=Math.max(f,M),d=Math.min(d,g),x=Math.max(x,g)),[M,g]},m=(L,T,j)=>L*c[0]+T*c[1]+j*c[2],p=(L,T=!0)=>L.map(j=>{let ue=b(j[0],j[1],j[2],T);return`${ue[0].toFixed(2)},${ue[1].toFixed(2)}`}).join(" "),S=(L,T,j="")=>`<polygon points="${p(L)}" fill="${T}"${j}/>`,w=(L,T,j)=>{let ue=Math.hypot(T[0],T[1],T[2]),M=[T[0]/ue,T[1]/ue,T[2]/ue];if(M[0]*c[0]+M[1]*c[1]+M[2]*c[2]<=5e-4)return null;let g=.64+.4*Math.max(0,M[0]*h[0]+M[1]*h[1]+M[2]*h[2]),F=ul(j,g),z=0;for(let G of L)z+=m(G[0],G[1],G[2]);return{d:z/L.length,s:S(L,F,` stroke="${F}" stroke-width=".05" stroke-linejoin="round"`)}},y=L=>L.filter(T=>T!==null).sort((T,j)=>T.d-j.d).map(T=>T.s).join(""),A=(L,T,j,ue,M,g,F)=>[w([[L,ue,M],[T,ue,M],[T,ue,g],[L,ue,g]],[0,1,0],F),w([[L,j,g],[T,j,g],[T,ue,g],[L,ue,g]],[0,0,1],F),w([[L,j,M],[T,j,M],[T,ue,M],[L,ue,M]],[0,0,-1],F),w([[T,j,M],[T,j,g],[T,ue,g],[T,ue,M]],[1,0,0],F),w([[L,j,M],[L,j,g],[L,ue,g],[L,ue,M]],[-1,0,0],F)],R=(L,T)=>{let ue=L.x0-.3,M=L.x1+.3,g=L.z0-.3,F=L.z1+.3,z=(L.z0+L.z1)/2,G=L.h,re=L.h+L.roof,fe=F-z;return[w([[ue,G,F],[M,G,F],[M,re,z],[ue,re,z]],[0,fe,L.roof],T),w([[ue,G,g],[M,G,g],[M,re,z],[ue,re,z]],[0,fe,-L.roof],T),w([[L.x0,G,g+.3],[L.x0,G,F-.3],[L.x0,re,z]],[-1,0,0],Qe.wall),w([[L.x1,G,g+.3],[L.x1,G,F-.3],[L.x1,re,z]],[1,0,0],Qe.wall)]},C=(L,T,j,ue,M)=>[L+Math.cos(ue)*j,M,T+Math.sin(ue)*j],_=(L,T)=>{let j=[];for(let ue=0;ue<L;ue++){let M=ue/L*2*Math.PI,g=(ue+1)/L*2*Math.PI;j.push(T(M,g,(M+g)/2))}return j},E=(L,T,j,ue,M,g,F,z)=>{let G=_(g,(fe,Q,ne)=>w([C(L,T,j,fe,ue),C(L,T,j,Q,ue),C(L,T,j,Q,M),C(L,T,j,fe,M)],[Math.cos(ne),0,Math.sin(ne)],F)),re=Array.from({length:g},(fe,Q)=>C(L,T,j,Q/g*2*Math.PI,M));return G.push(w(re,[0,1,0],z??F)),G},P=(L,T,j,ue,M,g,F)=>_(g,(z,G,re)=>w([C(L,T,j,z,ue),C(L,T,j,G,ue),[L,ue+M,T]],[Math.cos(re)*M,j,Math.sin(re)*M],F)),I=(L,T,j,ue,M,g)=>zs.f.map(F=>{let z=F.map(re=>{let fe=zs.v[re];return[L+fe[0]*ue,T+fe[1]*ue*M,j+fe[2]*ue]}),G=[0,1,2].map(re=>(zs.v[F[0]][re]+zs.v[F[1]][re]+zs.v[F[2]][re])/3);return w(z,[G[0],G[1]/M,G[2]],g)}),k=L=>{let T=[];for(let j of L)T.push([j[0],j[2]]),T.push([j[0]-h[0]/h[1]*j[1],j[2]-h[2]/h[1]*j[1]]);return S(gh(T).map(j=>[j[0],.03,j[1]]),"rgba(70,56,30,.17)")},Y=(L,T,j,ue,M,g)=>{let F=[];for(let z=0;z<g;z++){let G=z/g*2*Math.PI;F.push([L+Math.cos(G)*j,M,T+Math.sin(G)*ue])}return F},J=(L,T,j)=>{let ue=[],M=[];for(let g=0;g<L.length;g++){let F=L[Math.max(0,g-1)],z=L[Math.min(L.length-1,g+1)],G=z[0]-F[0],re=z[1]-F[1],fe=Math.hypot(G,re)||1,Q=-re/fe*T/2,ne=G/fe*T/2;ue.push([L[g][0]+Q,j,L[g][1]+ne]),M.unshift([L[g][0]-Q,j,L[g][1]-ne])}return ue.concat(M)},O=at,$=O.slab,V=[],ie=Hd($.w,$.d,$.r,0),he=-$.grass-$.earth;V.push(S(gh(ie.concat(ie.map(L=>[L[0]-h[0]/h[1]*1.6,L[1]-h[2]/h[1]*1.6]))).map(L=>[L[0],he,L[1]]),"rgba(70,56,30,.12)"));let xe=[];for(let L=0;L<ie.length;L++){let T=ie[L],j=ie[(L+1)%ie.length],ue=(T[0]+j[0])/2,M=(T[1]+j[1])/2,g=j[1]-T[1],F=-(j[0]-T[0]);g*ue+F*M<0&&(g=-g,F=-F),xe.push(w([[T[0],-$.grass,T[1]],[j[0],-$.grass,j[1]],[j[0],he,j[1]],[T[0],he,T[1]]],[g,0,F],Qe.earth)),xe.push(w([[T[0],0,T[1]],[j[0],0,j[1]],[j[0],-$.grass,j[1]],[T[0],-$.grass,T[1]]],[g,0,F],Qe.grassSide))}V.push(y(xe)),V.push(S(ie.map(L=>[L[0],0,L[1]]),Qe.grass)),V.push(S(J(Mn,O.streamW,.01),Qe.water));let ce=O.yard;V.push(S([[ce.x0,.01,ce.z0],[ce.x1,.01,ce.z0],[ce.x1,.01,ce.z1],[ce.x0,.01,ce.z1]],Qe.paving,` stroke="${Qe.stone}" stroke-width=".12"`)),V.push(S(Y(O.pond.x,O.pond.z,O.pond.rx,O.pond.rz,.012,36),Qe.water,` stroke="${Qe.stone}" stroke-width=".18"`)),V.push(S(J(Wt.pts,O.pathW,.02),Qe.path));for(let L of[O.mill,O.barn]){let T=L.h+L.roof*.6;V.push(k([[L.x0,T,L.z0],[L.x1,T,L.z0],[L.x1,T,L.z1],[L.x0,T,L.z1]]))}for(let L of ri){let T=(L.kind?1.6:2)*L.s,j=(L.kind?.75:.95)*L.s;V.push(k(Y(L.x,L.z,j,j,T,8)))}V.push(k(Y(O.oak.x,O.oak.z,O.oak.r*.95,O.oak.r*.95,O.oak.h+1.2,10)));let pe=i.fig&&i.fig.k>.5?i.fig:null;if(pe?.look&&i.wedge>.5){let T=17*xh,j=Math.atan2(pe.look[0]-pe.x,pe.look[1]-pe.z);V.push(S([[pe.x,.04,pe.z],[pe.x+Math.sin(j-T)*4.4,.04,pe.z+Math.cos(j-T)*4.4],[pe.x+Math.sin(j+T)*4.4,.04,pe.z+Math.cos(j+T)*4.4]],"rgba(207,68,40,.22)"))}for(let L=.3;L<i.route;L+=.62){let T=Wt.at(L),j=b(T.x,.05,T.z);V.push(`<ellipse cx="${j[0].toFixed(2)}" cy="${j[1].toFixed(2)}" rx=".17" ry="${(.17*l).toFixed(3)}" fill="${Qe.route}"/>`)}let nt=[],st=(L,T,j)=>nt.push({d:m(L,0,T),s:j}),qe=O.mill;st((qe.x0+qe.x1)/2,(qe.z0+qe.z1)/2,y(A(qe.x0,qe.x1,0,qe.h,qe.z0,qe.z1,Qe.wall).concat(R(qe,Qe.roof),A(-8.9,-8.1,0,1.3,qe.z1,qe.z1+.05,Qe.dark),A(-11.4,-10.6,1.2,1.9,qe.z1,qe.z1+.05,Qe.dark),A(-7.4,-6.8,1.2,1.9,qe.z1,qe.z1+.05,Qe.dark))));let ee=O.wheel,ve=[];for(let L=0;L<=16;L++){let T=L/16*2*Math.PI;ve.push([ee.x-ee.w,ee.y+Math.cos(T)*ee.r,ee.z+Math.sin(T)*ee.r])}st(ee.x,ee.z+2.5,`<polygon points="${p(ve)}" fill="none" stroke="${ul(Qe.wood,.8)}" stroke-width=".26"/>`);let le=O.barn;st((le.x0+le.x1)/2,(le.z0+le.z1)/2,y(A(le.x0,le.x1,0,le.h,le.z0,le.z1,Qe.wall).concat(R(le,Qe.roof2),A(8.5,9.3,0,1.2,le.z1,le.z1+.05,Qe.dark))));let Ne=O.fountain;st(Ne.x,Ne.z,y(E(Ne.x,Ne.z,1,0,.38,12,Qe.stone,Qe.water).concat(E(Ne.x,Ne.z,.18,.38,1.1,6,Qe.stone),E(Ne.x,Ne.z,.45,1.1,1.22,8,Qe.stone,Qe.water))));let Pe=O.lookout,Ee=Pe.s/2;st(Pe.x,Pe.z,y(A(Pe.x-Ee,Pe.x+Ee,0,Pe.h,Pe.z-Ee,Pe.z+Ee,Qe.stone).concat(A(Pe.x+Ee-.12,Pe.x+Ee,Pe.h,Pe.h+.8,Pe.z-Ee,Pe.z+Ee,Qe.wood),A(Pe.x-Ee,Pe.x+Ee,Pe.h,Pe.h+.8,Pe.z-Ee,Pe.z-Ee+.12,Qe.wood))));for(let L of ri){let T=E(L.x,L.z,.13*L.s,0,(L.kind?.5:.9)*L.s,5,Qe.trunk),j=L.kind?P(L.x,L.z,.75*L.s,.4*L.s,2.6*L.s,7,Qe.conifer):I(L.x,1.75*L.s,L.z,.95*L.s,.9,Qe.tree);st(L.x,L.z,y(T)+y(j))}let Ye=O.oak;st(Ye.x,Ye.z,y(E(Ye.x,Ye.z,.32,0,Ye.h,6,Qe.trunk))+y(I(Ye.x-.5,Ye.h+.9,Ye.z,Ye.r*.8,.85,Qe.tree).concat(I(Ye.x+.7,Ye.h+.7,Ye.z+.3,Ye.r*.75,.85,Qe.tree),I(Ye.x,Ye.h+1.4,Ye.z-.4,Ye.r*.8,.85,Qe.tree))));let Ue=O.poster;i.poster>.5&&st(Ue.x,Ue.z,y(A(Ue.x-.06,Ue.x+.06,0,1,Ue.z-.06,Ue.z+.06,Qe.wood).concat(A(Ue.x-.5,Ue.x+.5,.9,2.1,Ue.z+.06,Ue.z+.12,"#ffffff"))));let H=n==="over"?1.9:1.25,K=null;if(pe){let L=.62*H,T=b(pe.x,0,pe.z),j=b(pe.x,L,pe.z),ue=pe.who==="maker"?Qe.route:Qe.ink;K=b(pe.x,L+.25,pe.z,!1),st(pe.x,pe.z,`<line x1="${T[0].toFixed(2)}" y1="${(T[1]-.15).toFixed(2)}" x2="${j[0].toFixed(2)}" y2="${(j[1]+.3).toFixed(2)}" stroke="${ue}" stroke-width="${(.2*H).toFixed(2)}" stroke-linecap="round"/><circle cx="${j[0].toFixed(2)}" cy="${j[1].toFixed(2)}" r="${(.09*H).toFixed(2)}" fill="${Qe.paper}" stroke="${Qe.ink}" stroke-width=".05"/>`)}nt.sort((L,T)=>L.d-T.d).forEach(L=>V.push(L.s));let te=[];if(xn.forEach((L,T)=>{if((i.pins[T]??0)<.5)return;let j=L.pin[0],ue=L.pin[1],M=b(j,0,ue),g=b(j,O.pinH,ue),F=b(j,O.pinH-.85,ue);V.push(`<ellipse cx="${M[0].toFixed(2)}" cy="${M[1].toFixed(2)}" rx=".42" ry="${(.42*l).toFixed(2)}" fill="rgba(42,40,36,.22)"/>`),V.push(`<line x1="${M[0].toFixed(2)}" y1="${M[1].toFixed(2)}" x2="${F[0].toFixed(2)}" y2="${F[1].toFixed(2)}" stroke="${Qe.ink}" stroke-width=".07"/>`),V.push(`<path d="M${F[0].toFixed(2)} ${F[1].toFixed(2)} L${(g[0]-.5).toFixed(2)} ${(g[1]+.28).toFixed(2)} L${(g[0]+.5).toFixed(2)} ${(g[1]+.28).toFixed(2)} Z" fill="${ul(Qe.route,.85)}"/>`),V.push(`<circle cx="${g[0].toFixed(2)}" cy="${g[1].toFixed(2)}" r=".6" fill="${Qe.route}"/><circle cx="${(g[0]-.06).toFixed(2)}" cy="${(g[1]-.05).toFixed(2)}" r=".23" fill="#fff"/>`),te.push({x:g[0],y:g[1]-.75,n:String(L.n),t:L.name})}),i.poster>.5){let L=b(Ue.x,2.4,Ue.z);te.push({x:L[0],y:L[1]-.2,n:"",t:"Start: the code"})}pe&&K&&te.push({x:K[0],y:K[1]-.1,n:"",t:pe.who==="maker"?"You":"A visitor",who:pe.who});let ge,de;if(n==="over"){let j=[u-1.2,d-2.4,f-u+2.4,x-d+1.2+2.4];de=Math.min(t.W/j[2],t.H/j[3]),ge=[j[0]-(t.W/de-j[2])/2,j[1]-(t.H/de-j[3])/2,t.W/de,t.H/de]}else{let L=1e9,T=1e9,j=-1e9,ue=-1e9;for(let re of Bs[n]){let fe=b(re[0],re[1],re[2],!1);L=Math.min(L,fe[0]),j=Math.max(j,fe[0]),T=Math.min(T,fe[1]),ue=Math.max(ue,fe[1])}let M=hl(t),g=M.x1-M.x0,F=M.y1-M.y0,z=j-L,G=ue-T;de=Math.min(g/z,F/G),ge=[L-(M.x0+(g-z*de)/2)/de,T-(M.y0+(F-G*de)/2)/de,t.W/de,t.H/de]}let We=12/de,He="";for(let L of te){let T=(L.x-ge[0])*de,j=(L.y-ge[1])*de;if(T<34||T>t.W-34||j<18||j>t.H-4)continue;let ue=(L.t.length*.5+(L.n?1.9:1.2))*We,M=1.55*We,g=L.x-ue/2,F=L.y-M,z=L.n||L.who?"rgba(251,248,239,.94)":Qe.ink,G=L.n||L.who?L.who==="maker"?Qe.route:Qe.ink:Qe.paper,re=L.n?`<circle cx="${(g+M/2).toFixed(2)}" cy="${(F+M/2).toFixed(2)}" r="${(M/2-1.6/de).toFixed(2)}" fill="${Qe.route}"/><text x="${(g+M/2).toFixed(2)}" y="${(F+M/2).toFixed(2)}" font-family="system-ui, sans-serif" font-weight="700" font-size="${(We*.9).toFixed(2)}" fill="#fff" text-anchor="middle" dominant-baseline="central">${L.n}</text>`:"";He+=`<g class="lf-lb" data-x="${L.x.toFixed(2)}" data-h="${M.toFixed(3)}" data-fs="${We.toFixed(3)}" data-n="${L.n?1:0}"><rect x="${g.toFixed(2)}" y="${F.toFixed(2)}" width="${ue.toFixed(2)}" height="${M.toFixed(2)}" rx="${(M/2).toFixed(2)}" fill="${z}" stroke="${L.who==="maker"?Qe.route:Qe.ink}" stroke-width="${(1/de).toFixed(3)}"/>`+re+`<text x="${(L.n?g+M+.3*We:L.x).toFixed(2)}" y="${(F+M/2).toFixed(2)}" font-family="${L.who?"system-ui, sans-serif":"Georgia, serif"}"${L.who?"":' font-style="italic"'} font-weight="600" font-size="${We.toFixed(2)}" fill="${G}"${L.n?"":' text-anchor="middle"'} dominant-baseline="central" class="lf-nm">${L.t}</text></g>`}let je=K&&e&&n!=="over"?[(K[0]-ge[0])*de,(K[1]-ge[1])*de]:null;return{viewBox:ge.map(L=>L.toFixed(2)).join(" "),markup:V.join("")+He,lead:je}}function yh(i,e){let t=i.fig;return[i.view,i.pins.map(n=>n>.5?1:0).join(""),i.poster>.5,t&&t.k>.5?`${t.who}${Math.round(t.x)},${Math.round(t.z)}`:"-",i.wedge>.5,e,Math.floor(i.route/1.5)].join("|")}function vh(i){let e=i.webgl?"3d":"floor",t=0,n=1,s=r=>e==="floor"?null:(e="floor",t=0,r);return{kind:()=>e,initialFallback:i.webgl?null:"no-webgl",wantsScene:()=>e==="3d"&&t===0,created(){return t=n++,t},createFailed:()=>s("no-webgl"),released(){t=0},contextLost(r){return r===0||r!==t?null:s("context-lost")}}}function bh(i){return!Number.isFinite(i)||i<0?0:i>1?1:i}var Gd=52,Wd=1e-12;function Jr(i,e,t){if(!Number.isFinite(e))throw new RangeError(`cubicBezierEasing: ${i} must be a finite number, got ${e}`);if(t&&(e<0||e>1))throw new RangeError(`cubicBezierEasing: ${i} must be within [0, 1] (CSS requires it, and the curve is only a function of x then), got ${e}`)}function ks(i,e,t,n){Jr("x1",i,!0),Jr("y1",e,!1),Jr("x2",t,!0),Jr("y2",n,!1);let s=(r,a,o)=>{let l=1-o;return 3*l*l*o*r+3*l*o*o*a+o*o*o};return r=>{let a=bh(r);if(a===0)return 0;if(a===1)return 1;let o=0,l=1,c=.5;for(let h=0;h<Gd&&(c=(o+l)/2,s(i,t,c)<a?o=c:l=c,!(l-o<Wd));h+=1);return s(e,n,c)}}var P_=ks(0,0,.2,1);function et(i,e,t){return Ti((i-e)/(t-e))}function dl(i){return i>0&&i<1?Math.sin(Math.PI*i):0}var Ai=ks(1/3,0,2/3,1),Qt=ks(1/3,1,2/3,1),ji=ks(1/3,4.7/3,2/3,1);var Kr=xn.length;function Xd(){return{route:0,pins:new Array(Kr).fill(0),pulse:new Array(Kr).fill(0),poster:0,fig:null,wedge:0,view:"over"}}function qd(){return{on:!1,eye:"mill",cover:1,pill:"visit",chip:0,retic:0,glide:0,press:0,ripple:0,pinF:0,posterF:0,place:0,tools:0,toolPic:!1,card:0,typed:99,body:1,dashed:!1,ghost:0,pic:0,next:0,share:0,print:0,halo:0,callout:0,scan:0,polaroid:0}}function fl(i){i.route=si,i.pins=new Array(Kr).fill(1),i.poster=1}function Qi(i,e,t,n,s){i.fig={who:e,x:t[0],z:t[1],k:n,yaw:Math.atan2(s[0]-t[0],s[2]-t[1]),look:[s[0],s[2]],bob:0}}function Mh(i,e,t,n){i.fig={who:e,x:t.x,z:t.z,k:1,yaw:Math.atan2(t.tx,t.tz),look:null,bob:n}}var Yd=xn.map(i=>{let e=i.s/si,t=0,n=1;for(let s=0;s<30;s++){let r=(t+n)/2;Ai(r)<e?t=r:n=r}return .5+3*n}),Vs="The old mill",jr=[{durS:4.3,views:[{atS:0,view:"over"}],title:"A tour",caption:"A tour is a walk with stories on real spots.",apply(i,e){e.view="over",e.poster=ji(et(i,.2,.7)),e.route=si*Ai(et(i,.5,3.5)),e.pins=Yd.map(t=>ji(et(i,t,t+.6)))}},{durS:2.7,views:[{atS:0,view:"mill"}],title:"What a visitor sees",caption:"A visitor holds up the phone. The story is right there.",apply(i,e,t){fl(e),e.view="mill",Qi(e,"visitor",lt.mill,Qt(et(i,0,.3)),Pn.mill),e.wedge=et(i,.65,1),t.on=i>=.3,t.eye="mill",t.cover=1-et(i,.65,1),t.pill="visit",t.pinF=1,t.card=Qt(et(i,1.05,1.5)),t.pic=Qt(et(i,1.55,2.1)),t.next=et(i,2.25,2.65)}},{durS:2.1,views:[{atS:0,view:"mill"}],title:"A story you know",caption:"Making one: start with a story you know.",apply(i,e,t){let n=1-Ai(et(i,.75,1.3));e.view="mill",e.route=si*(1-et(i,.75,1.25)),e.pins=new Array(Kr).fill(n),e.poster=n;let s=et(i,.3,.6);Qi(e,s<.5?"visitor":"maker",lt.mill,s<.5?1-2*s:Qt(2*s-1),Pn.mill),e.wedge=1-et(i,0,.3),t.on=i<.3,t.eye="mill",t.cover=0,t.pill="visit",t.pinF=1,t.card=1,t.pic=1,t.next=1,t.polaroid=Qt(et(i,1.45,1.95))}},{durS:3.9,views:[{atS:0,view:"mill"}],title:"Walk there",caption:"Walk there with your phone and tap. A station drops onto that spot.",apply(i,e,t){let n=ji(et(i,2.45,3.05));e.view="mill",e.pins=[n,0,0,0,0],Qi(e,"maker",lt.mill,1,Pn.mill),e.wedge=et(i,.7,1),t.polaroid=1-et(i,0,.3),t.on=i>=.35,t.eye="mill",t.cover=1-et(i,.7,1),t.pill="make",t.place=1,t.retic=et(i,1.1,1.35)*(1-et(i,2.45,2.75)),t.glide=1-Qt(et(i,1.1,2.1)),t.press=dl(et(i,2.15,2.45)),t.pinF=n,t.ripple=et(i,2.7,3.7)}},{durS:4.1,views:[{atS:0,view:"mill"}],title:"Add words and a picture",caption:"Add a few lines and the old photo. They stay on that spot.",apply(i,e,t){e.view="mill",e.pins=[1,0,0,0,0],Qi(e,"maker",lt.mill,1,Pn.mill),e.wedge=1,t.on=!0,t.eye="mill",t.cover=0,t.pill="make",t.pinF=1,t.place=1-et(i,0,.25),t.tools=et(i,.25,.5),t.card=Qt(et(i,.45,.9)),t.dashed=!0,t.typed=Math.round(et(i,.95,1.85)*Vs.length),t.body=et(i,1.9,2.3),t.toolPic=i>=2.4,t.ghost=et(i,2.5,2.75)*(1-et(i,3.3,3.5)),t.pic=Qt(et(i,3.25,3.85))}},{durS:7.6,views:[{atS:0,view:"over"}],title:"Along the walk",caption:"The same at every spot along the walk.",apply(i,e){e.view="over";let t=et(i,.9,7.4),n=$i+(si-$i)*t;e.route=i<.9?$i*Ai(et(i,0,.6)):n,e.pins=xn.map((s,r)=>{if(r===0)return 1;let a=.9+6.5*(s.s-$i)/(si-$i);return ji(et(i,a,a+.6))}),Mh(e,"maker",Wt.at(n),i<.9||t>=1?0:1)}},{durS:4.3,views:[{atS:0,view:"poster"}],title:"Hang the code",caption:"When the tour is ready, print its code and hang it where the walk begins.",apply(i,e,t){fl(e),e.poster=ji(et(i,2.3,3.1)),e.view="poster",Qi(e,"maker",lt.poster,Qt(et(i,0,.3)),Pn.poster),e.wedge=et(i,.65,1),t.on=i>=.3,t.eye="poster",t.cover=1-et(i,.65,1),t.pill="saved",t.share=Qt(et(i,1,1.4))*(1-et(i,2.3,2.6)),t.print=dl(et(i,1.9,2.2)),t.posterF=e.poster,t.halo=et(i,3.1,3.45),t.callout=Qt(et(i,3.4,3.9))}},{durS:12.6,views:[{atS:0,view:"poster"},{atS:3.3,view:"over"}],title:"Visitors scan it, no app to install",caption:"Visitors scan it there to open the tour in their phone's browser. No app to install.",apply(i,e,t){if(fl(e),e.view=i<3.3?"poster":"over",i<4.6)Qi(e,"visitor",lt.scan,Qt(et(i,0,.3)),Pn.scan);else{let n=et(i,4.6,12.3)*(Zi+si),s;if(n<Zi){let a=n/Zi;s={x:lt.scan[0]+(Gn.x-lt.scan[0])*a,z:lt.scan[1]+(Gn.z-lt.scan[1])*a,tx:Gn.x-lt.scan[0],tz:Gn.z-lt.scan[1]}}else s=Wt.at(n-Zi);Mh(e,"visitor",s,i>=12.3?0:1);let r=n-Zi;e.pulse=xn.map(a=>Math.max(0,1-Math.abs(r-a.s)/1.4))}e.wedge=et(i,.65,1)*(1-et(i,2.9,3.1)),t.on=i>=.3&&i<3,t.eye="scan",t.cover=1-et(i,.65,1),t.pill="scan",t.posterF=1,t.scan=Qt(et(i,1,1.7)),t.chip=et(i,1.75,2.05)}}],Sh=jr,pl=jr.map(i=>i.title),ml=jr.map(i=>i.caption);function wh(i,e){let t=jr[i];if(t===void 0||!Number.isInteger(i))throw new RangeError(`film story: no part ${String(i)}`);let n=Xd(),s=qd();return t.apply(Math.min(t.durS,Math.max(0,Number.isFinite(e)?e:0)),n,s),{s:n,u:s}}var $d={mill:{pin:[.47,.47],ground:[.47,.705],next:[.5,.88]},poster:{board:[.33,.4,.67,.71],ground:[.5,.8],next:[.5,.88]},scan:{board:[.27,.34,.73,.77],ground:[.5,.85],next:[.5,.88]}};function Th(i,e,t){let n=$d[i];return{...n.pin?{pin:[n.pin[0]*e,n.pin[1]*t]}:{},...n.board?{board:[n.board[0]*e,n.board[1]*t,n.board[2]*e,n.board[3]*t]}:{},ground:[n.ground[0]*e,n.ground[1]*t],next:[n.next[0]*e,n.next[1]*t]}}var Eh=(i,e,t)=>Math.max(e,Math.min(t,i)),Zd=3;function Jd(i,e,t){if(![i,e,t].every(Number.isFinite))return 0;let n=i+e+Zd-t;return Math.max(0,Math.min(n,i-2))}function Kd(i,e,t){let n=i.pin??[e/2,t*.4],s=Math.max(n[1],t*.42),r={card:[Eh(n[0],e*.44,e*.56),s],pic:[Eh(n[0]-e*.46,e*.04,e*.6),s+t*.03],ret:i.ground,pinf:i.ground,next:i.next},a=null;if(i.board){let[o,l,c,h]=i.board,u=c-o,d=h-l;r.halo=[o-5,l-5],r.posterf=[o,l],r.call=[(o+c)/2,l-6],a={halo:{w:u+10,h:d+10},scan:{w:u+16,h:d+16},poster:{w:u,h:d*70/46},frameTop:l-8}}return{at:r,pinMarginTop:-(i.ground[1]-n[1])-4,board:a}}var It=i=>i.toFixed(3);function gl(i){return{opacity:It(i),transform:`translateY(${((1-i)*.8).toFixed(2)}em)`,visibility:i>.001?"visible":"hidden"}}function jd(i){return{cover:{opacity:i.on?It(i.cover):"1"},chip:{opacity:It(i.chip),transform:`translateX(-50%) translateY(${((1-i.chip)*-.4).toFixed(2)}em)`},place:gl(i.place),tools:gl(i.tools),share:gl(i.share),placeBtn:{transform:`scale(${It(1-.06*i.press)})`,background:i.press>.3?"var(--lf-route-dark)":""},printBtn:{transform:`scale(${It(1-.06*i.print)})`,background:i.print>.3?"var(--lf-route-dark)":""},retic:{opacity:It(i.retic),transform:`translate(${(i.glide*34).toFixed(1)}px,${(i.glide*46).toFixed(1)}px)`},ripple:{opacity:It(i.ripple>0&&i.ripple<1?.9*(1-i.ripple):0),transform:`scale(${It(.7+1.4*i.ripple)})`},pinF:{opacity:i.pinF>.01?"1":"0",transform:`scaleY(${It(Math.max(.001,i.pinF))})`},posterF:{opacity:i.posterF>.01?"1":"0",transform:`translateY(${((1-Math.min(1,i.posterF))*-14).toFixed(1)}px) scale(${It(Math.max(.001,i.posterF))})`},halo:{opacity:It(i.halo)},scan:{opacity:It(i.scan>0?Math.min(1,i.scan*3):0),transform:`scale(${It(1.35-.35*i.scan)})`},card:{opacity:It(i.card),transform:`translateX(-50%) translateY(${((1-i.card)*.8).toFixed(2)}em) scale(${It(.94+.06*i.card)})`},body:{opacity:It(i.body)},ghost:{opacity:It(i.ghost)},pic:{opacity:It(i.pic),transform:`scale(${It(.82+.18*i.pic)}) rotate(${(-3+i.pic).toFixed(2)}deg)`},next:{opacity:It(i.next)},callout:{opacity:It(i.callout),transform:`translateX(-50%) translateY(${((1-i.callout)*.8).toFixed(2)}em)`},polaroid:{opacity:It(i.polaroid)}}}var Qd={visit:'Mill Park<span class="lf-dots"><i class="lf-on"></i><i></i><i></i><i></i><i></i></span>',make:'<span class="lf-tg">Making</span>Station 1',saved:'<span class="lf-tg lf-ok">Saved</span>5 stations',scan:"Scan the code"};function ef(i){let e=Math.max(0,Math.min(Vs.length,Math.round(i.typed)));return{text:Vs.slice(0,e),caret:i.dashed&&e<Vs.length&&i.card>.5}}function tf(i){return Math.max(13,Math.min(17,i*.066))}var nf=158;function Ah(i){let e=i.parts,t={cover:e.cover,chip:e.chip,place:e.place,tools:e.tools,share:e.share,placeBtn:e.placeBtn,printBtn:e.printBtn,retic:e.retic,ripple:e.ripple,pinF:e.pinF,posterF:e.posterF,halo:e.halo,scan:e.scan,card:e.card,body:e.body,ghost:e.ghost,pic:e.pic,next:e.next,callout:e.callout,polaroid:i.polaroid},n=new Map,s=0,r=(u,d,f)=>{let x=n.get(u)??{};x[d]!==f&&(x[d]=f,n.set(u,x),u.style.setProperty(d,f))},a=(u,d)=>r(u,"transform",`translate(${d[0].toFixed(1)}px,${d[1].toFixed(1)}px)`),o="",l="",c=null,h="";return{eye:()=>o===""?"mill":o,apply(u){if(u.on!==c&&(c=u.on,i.phone.classList.toggle("lf-on",u.on)),u.eye!==o){o=u.eye;let x=u.eye==="mill"?"mill":"poster";for(let b of e.stills)b.style.display=b.dataset.still===x?"":"none"}u.pill!==l&&(l=u.pill,e.pill.innerHTML=Qd[u.pill]);let d=jd(u);for(let x of Object.keys(d)){let b=t[x];for(let[m,p]of Object.entries(d[x]))r(b,m,p)}e.card.classList.toggle("lf-dashed",u.dashed),e.toolText.classList.toggle("lf-sel",!u.toolPic),e.toolPic.classList.toggle("lf-sel",u.toolPic);let f=ef(u);f.text!==h&&(h=f.text,e.typed.textContent=f.text),e.caret.classList.toggle("lf-on",f.caret)},layout(u){let d=u.phone;r(i.phone,"transform",`translate(${String(d.x)}px,${String(d.y)}px)`),r(i.phone,"width",`${String(d.w)}px`),r(i.phone,"height",`${String(d.h)}px`),r(i.screen,"--lf-sw",`${String(u.screen.w)}px`),r(i.screen,"--lf-fs",`${tf(u.screen.w).toFixed(2)}px`),i.screen.classList.toggle("lf-narrow",u.screen.w<nf);let f=u.polaroid;r(i.polaroid,"width",`${f.w.toFixed(1)}px`),r(i.polaroid,"transform",`translate(${String(f.x)}px,${String(f.y)}px) rotate(-4deg)`)},place(u,d){let f=Kd(u,d.screen.w,d.screen.h);for(let[x,b]of Object.entries(f.at))a(e.anchors[x],b);if(r(e.pinF,"margin-top",`${f.pinMarginTop.toFixed(1)}px`),f.board){r(e.halo,"width",`${f.board.halo.w.toFixed(1)}px`),r(e.halo,"height",`${f.board.halo.h.toFixed(1)}px`),r(e.scan,"width",`${f.board.scan.w.toFixed(1)}px`),r(e.scan,"height",`${f.board.scan.h.toFixed(1)}px`),r(e.scan,"left","-3px"),r(e.scan,"top","-3px"),r(e.posterF,"width",`${f.board.poster.w.toFixed(1)}px`),r(e.posterF,"height",`${f.board.poster.h.toFixed(1)}px`);let x=e.chip.offsetTop+s;s=Jd(x,e.chip.offsetHeight,f.board.frameTop),r(e.chip,"--lf-chip-lift",`${s.toFixed(1)}px`)}}}}function xl(i,e){return i<e}function Rh(i){if(!(Number.isFinite(i.startShare)&&i.startShare>0&&i.startShare<=1))throw new RangeError(`film player: startShare must be in (0, 1], got ${String(i.startShare)}`);if(!(Number.isFinite(i.leaveShare)&&i.leaveShare>=0&&i.leaveShare<i.startShare))throw new RangeError(`film player: leaveShare must be in [0, startShare), got ${String(i.leaveShare)}`);let e=i.maxStepS??.1,t=i.timeline.totalS,n=i.reducedMotion?"finished":"waiting",s=null,r=i.reducedMotion?t:0,a=i.reducedMotion,o=0,l=!0,c=0,h=null,u=!1,d=()=>({status:n,pausedBy:s,t:r,position:i.timeline.positionAt(r),opening:a,moving:n==="playing"&&o>=i.startShare}),f=()=>{u||i.onChange(d())},x=()=>{c!==0&&i.cancelFrame(c),c=0},b=()=>{c===0&&!u&&(c=i.requestFrame(m))};function m(A){if(c=0,u||n!=="playing")return;let R=h===null?0:Math.min(e,Math.max(0,(A-h)/1e3));h=A,r=Math.min(t,r+R),r>=t&&(r=t,n="finished"),i.render(r),f(),n==="playing"&&b()}let p=()=>{u||(n="playing",s=null,a=!1,l=!0,h=null,b())},S=A=>{x(),n="paused",s=A},w=A=>{r=A,i.render(r)},y=()=>{u||n==="finished"||(n==="playing"?S("user"):p(),f())};return{snapshot:d,setViewShare(A){u||(o=Number.isFinite(A)?Math.min(1,Math.max(0,A)):0,xl(o,i.leaveShare)?(l=!0,n==="playing"&&S("view")):o>=i.startShare&&l&&(n==="waiting"&&!i.reducedMotion||n==="paused"&&s!=="user")&&p(),f())},tap:y,toggle(){if(!u){if(n==="finished"){w(0),p(),f();return}y()}},jumpTo(A){let R=i.timeline.startOf(A);u||(x(),w(R),p(),f())},release(){u||(n==="playing"?S("release"):n==="paused"&&s==="view"&&(s="release"),n!=="finished"&&(l=!1),f())},redraw(){u||(i.render(r),f())},destroy(){x(),u=!0}}}/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */var iu=0,rc=1,su=2;var ki=1,ru=2,Es=3,Jn=0,Zt=1,rn=2,zn=0,Di=1,ac=2,oc=3,lc=4,au=5;var fi=100,ou=101,lu=102,cu=103,hu=104,uu=200,du=201,fu=202,pu=203,Sa=204,wa=205,mu=206,gu=207,xu=208,_u=209,yu=210,vu=211,bu=212,Mu=213,Su=214,Ea=0,Ta=1,Aa=2,Ui=3,Ra=4,Ca=5,Pa=6,Ia=7,co=0,wu=1,Eu=2,An=0,cc=1,hc=2,uc=3,dc=4,fc=5,pc=6,mc=7;var gc=300,yi=301,Vi=302,ho=303,uo=304,Cr=306,La=1e3,Fn=1001,Fa=1002,kt=1003,Tu=1004;var Pr=1005;var Ht=1006,fo=1007;var vi=1008;var an=1009,xc=1010,_c=1011,Ts=1012,po=1013,Rn=1014,vn=1015,kn=1016,mo=1017,go=1018,As=1020,yc=35902,vc=35899,bc=1021,Mc=1022,bn=1023,Nn=1026,bi=1027,xo=1028,_o=1029,Mi=1030,yo=1031;var vo=1033,Ir=33776,Lr=33777,Fr=33778,Nr=33779,bo=35840,Mo=35841,So=35842,wo=35843,Eo=36196,To=37492,Ao=37496,Ro=37488,Co=37489,Dr=37490,Po=37491,Io=37808,Lo=37809,Fo=37810,No=37811,Do=37812,Uo=37813,Oo=37814,Bo=37815,zo=37816,ko=37817,Vo=37818,Ho=37819,Go=37820,Wo=37821,Xo=36492,qo=36494,Yo=36495,$o=36283,Zo=36284,Ur=36285,Jo=36286;var js=2300,Na=2301,Ma=2302,Xl=2303,ql=2400,Yl=2401,$l=2402;var Au=3200;var Ko=0,Ru=1,ei="",hn="srgb",Qs="srgb-linear",er="linear",bt="srgb";var Li=7680;var Zl=519,Cu=512,Pu=513,Iu=514,jo=515,Lu=516,Fu=517,Qo=518,Nu=519,Jl=35044;var Sc="300 es",Tn=2e3,ps=2001;function sf(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function rf(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function tr(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Du(){let i=tr("canvas");return i.style.display="block",i}var Ch={},ms=null;function wc(...i){let e="THREE."+i.shift();ms?ms("log",e,...i):console.log(e,...i)}function Uu(i){let e=i[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=i[1];t&&t.isStackTrace?i[0]+=" "+t.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function tt(...i){i=Uu(i);let e="THREE."+i.shift();if(ms)ms("warn",e,...i);else{let t=i[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...i)}}function it(...i){i=Uu(i);let e="THREE."+i.shift();if(ms)ms("error",e,...i);else{let t=i[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...i)}}function Ni(...i){let e=i.join(" ");e in Ch||(Ch[e]=!0,tt(...i))}function Ou(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}var Bu={[Ea]:Ta,[Aa]:Pa,[Ra]:Ia,[Ui]:Ca,[Ta]:Ea,[Pa]:Aa,[Ia]:Ra,[Ca]:Ui},Dn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},Xt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var _l=Math.PI/180,Da=180/Math.PI;function Rs(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Xt[i&255]+Xt[i>>8&255]+Xt[i>>16&255]+Xt[i>>24&255]+"-"+Xt[e&255]+Xt[e>>8&255]+"-"+Xt[e>>16&15|64]+Xt[e>>24&255]+"-"+Xt[t&63|128]+Xt[t>>8&255]+"-"+Xt[t>>16&255]+Xt[t>>24&255]+Xt[n&255]+Xt[n>>8&255]+Xt[n>>16&255]+Xt[n>>24&255]).toLowerCase()}function ft(i,e,t){return Math.max(e,Math.min(t,i))}function af(i,e){return(i%e+e)%e}function yl(i,e,t){return(1-t)*i+t*e}function Hs(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function en(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}var we=class i{static{i.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("THREE.Vector2: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=ft(this.x,e.x,t.x),this.y=ft(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=ft(this.x,e,t),this.y=ft(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(ft(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(ft(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Un=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let l=n[s+0],c=n[s+1],h=n[s+2],u=n[s+3],d=r[a+0],f=r[a+1],x=r[a+2],b=r[a+3];if(u!==b||l!==d||c!==f||h!==x){let m=l*d+c*f+h*x+u*b;m<0&&(d=-d,f=-f,x=-x,b=-b,m=-m);let p=1-o;if(m<.9995){let S=Math.acos(m),w=Math.sin(S);p=Math.sin(p*S)/w,o=Math.sin(o*S)/w,l=l*p+d*o,c=c*p+f*o,h=h*p+x*o,u=u*p+b*o}else{l=l*p+d*o,c=c*p+f*o,h=h*p+x*o,u=u*p+b*o;let S=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=S,c*=S,h*=S,u*=S}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,a){let o=n[s],l=n[s+1],c=n[s+2],h=n[s+3],u=r[a],d=r[a+1],f=r[a+2],x=r[a+3];return e[t]=o*x+h*u+l*f-c*d,e[t+1]=l*x+h*d+c*u-o*f,e[t+2]=c*x+h*f+o*d-l*u,e[t+3]=h*x-o*u-l*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(s/2),u=o(r/2),d=l(n/2),f=l(s/2),x=l(r/2);switch(a){case"XYZ":this._x=d*h*u+c*f*x,this._y=c*f*u-d*h*x,this._z=c*h*x+d*f*u,this._w=c*h*u-d*f*x;break;case"YXZ":this._x=d*h*u+c*f*x,this._y=c*f*u-d*h*x,this._z=c*h*x-d*f*u,this._w=c*h*u+d*f*x;break;case"ZXY":this._x=d*h*u-c*f*x,this._y=c*f*u+d*h*x,this._z=c*h*x+d*f*u,this._w=c*h*u-d*f*x;break;case"ZYX":this._x=d*h*u-c*f*x,this._y=c*f*u+d*h*x,this._z=c*h*x-d*f*u,this._w=c*h*u+d*f*x;break;case"YZX":this._x=d*h*u+c*f*x,this._y=c*f*u+d*h*x,this._z=c*h*x-d*f*u,this._w=c*h*u-d*f*x;break;case"XZY":this._x=d*h*u-c*f*x,this._y=c*f*u-d*h*x,this._z=c*h*x+d*f*u,this._w=c*h*u+d*f*x;break;default:tt("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-l)*f,this._y=(r-c)*f,this._z=(a-s)*f}else if(n>o&&n>u){let f=2*Math.sqrt(1+n-o-u);this._w=(h-l)/f,this._x=.25*f,this._y=(s+a)/f,this._z=(r+c)/f}else if(o>u){let f=2*Math.sqrt(1+o-n-u);this._w=(r-c)/f,this._x=(s+a)/f,this._y=.25*f,this._z=(l+h)/f}else{let f=2*Math.sqrt(1+u-n-o);this._w=(a-s)/f,this._x=(r+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(ft(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+s*c-r*l,this._y=s*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-s*o,this._w=a*h-n*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,s=-s,r=-r,a=-a,o=-o);let l=1-t;if(o<.9995){let c=Math.acos(o),h=Math.sin(c);l=Math.sin(l*c)/h,t=Math.sin(t*c)/h,this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this._onChangeCallback()}else this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},U=class i{static{i.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("THREE.Vector3: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Ph.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Ph.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*n),h=2*(o*t-r*s),u=2*(r*n-a*t);return this.x=t+l*c+a*u-o*h,this.y=n+l*h+o*c-r*u,this.z=s+l*u+r*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=ft(this.x,e.x,t.x),this.y=ft(this.y,e.y,t.y),this.z=ft(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=ft(this.x,e,t),this.y=ft(this.y,e,t),this.z=ft(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(ft(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,l=t.z;return this.x=s*l-r*o,this.y=r*a-n*l,this.z=n*o-s*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return vl.copy(this).projectOnVector(e),this.sub(vl)}reflect(e){return this.sub(vl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(ft(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},vl=new U,Ph=new Un,rt=class i{static{i.prototype.isMatrix3=!0}constructor(e,t,n,s,r,a,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c)}set(e,t,n,s,r,a,o,l,c){let h=this.elements;return h[0]=e,h[1]=s,h[2]=o,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],f=n[5],x=n[8],b=s[0],m=s[3],p=s[6],S=s[1],w=s[4],y=s[7],A=s[2],R=s[5],C=s[8];return r[0]=a*b+o*S+l*A,r[3]=a*m+o*w+l*R,r[6]=a*p+o*y+l*C,r[1]=c*b+h*S+u*A,r[4]=c*m+h*w+u*R,r[7]=c*p+h*y+u*C,r[2]=d*b+f*S+x*A,r[5]=d*m+f*w+x*R,r[8]=d*p+f*y+x*C,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*r*h+n*o*l+s*r*c-s*a*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=h*a-o*c,d=o*l-h*r,f=c*r-a*l,x=t*u+n*d+s*f;if(x===0)return this.set(0,0,0,0,0,0,0,0,0);let b=1/x;return e[0]=u*b,e[1]=(s*c-h*n)*b,e[2]=(o*n-s*a)*b,e[3]=d*b,e[4]=(h*t-s*l)*b,e[5]=(s*r-o*t)*b,e[6]=f*b,e[7]=(n*l-c*t)*b,e[8]=(a*t-n*r)*b,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return Ni("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(bl.makeScale(e,t)),this}rotate(e){return Ni("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(bl.makeRotation(-e)),this}translate(e,t){return Ni("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(bl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},bl=new rt,Ih=new rt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Lh=new rt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function of(){let i={enabled:!0,workingColorSpace:Qs,spaces:{},convert:function(s,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===bt&&(s.r=Zn(s.r),s.g=Zn(s.g),s.b=Zn(s.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===bt&&(s.r=fs(s.r),s.g=fs(s.g),s.b=fs(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===ei?er:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,a){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(s,r){return Ni("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(s,r)},toWorkingColorSpace:function(s,r){return Ni("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(s,r)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Qs]:{primaries:e,whitePoint:n,transfer:er,toXYZ:Ih,fromXYZ:Lh,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:hn},outputColorSpaceConfig:{drawingBufferColorSpace:hn}},[hn]:{primaries:e,whitePoint:n,transfer:bt,toXYZ:Ih,fromXYZ:Lh,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:hn}}}),i}var mt=of();function Zn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function fs(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var es,Ua=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{es===void 0&&(es=tr("canvas")),es.width=e.width,es.height=e.height;let s=es.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=es}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=tr("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=Zn(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Zn(t[n]/255)*255):t[n]=Zn(t[n]);return{data:t,width:e.width,height:e.height}}else return tt("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},lf=0,gs=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:lf++}),this.uuid=Rs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(Ml(s[a].image)):r.push(Ml(s[a]))}else r=Ml(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function Ml(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Ua.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(tt("Texture: Unable to serialize Texture."),{})}var cf=0,Sl=new U,nn=class i extends Dn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=Fn,s=Fn,r=Ht,a=vi,o=bn,l=an,c=i.DEFAULT_ANISOTROPY,h=ei){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:cf++}),this.uuid=Rs(),this.name="",this.source=new gs(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new we(0,0),this.repeat=new we(1,1),this.center=new we(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new rt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Sl).x}get height(){return this.source.getSize(Sl).y}get depth(){return this.source.getSize(Sl).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){tt(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){tt(`Texture.setValues(): property '${t}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==gc)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case La:e.x=e.x-Math.floor(e.x);break;case Fn:e.x=e.x<0?0:1;break;case Fa:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case La:e.y=e.y-Math.floor(e.y);break;case Fn:e.y=e.y<0?0:1;break;case Fa:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};nn.DEFAULT_IMAGE=null;nn.DEFAULT_MAPPING=gc;nn.DEFAULT_ANISOTROPY=1;var Rt=class i{static{i.prototype.isVector4=!0}constructor(e=0,t=0,n=0,s=1){this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("THREE.Vector4: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],f=l[5],x=l[9],b=l[2],m=l[6],p=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-b)<.01&&Math.abs(x-m)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+b)<.1&&Math.abs(x+m)<.1&&Math.abs(c+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let w=(c+1)/2,y=(f+1)/2,A=(p+1)/2,R=(h+d)/4,C=(u+b)/4,_=(x+m)/4;return w>y&&w>A?w<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(w),s=R/n,r=C/n):y>A?y<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(y),n=R/s,r=_/s):A<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(A),n=C/r,s=_/r),this.set(n,s,r,t),this}let S=Math.sqrt((m-x)*(m-x)+(u-b)*(u-b)+(d-h)*(d-h));return Math.abs(S)<.001&&(S=1),this.x=(m-x)/S,this.y=(u-b)/S,this.z=(d-h)/S,this.w=Math.acos((c+f+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=ft(this.x,e.x,t.x),this.y=ft(this.y,e.y,t.y),this.z=ft(this.z,e.z,t.z),this.w=ft(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=ft(this.x,e,t),this.y=ft(this.y,e,t),this.z=ft(this.z,e,t),this.w=ft(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(ft(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Oa=class extends Dn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Ht,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new Rt(0,0,e,t),this.scissorTest=!1,this.viewport=new Rt(0,0,e,t),this.textures=[];let s={width:e,height:t,depth:n.depth},r=new nn(s),a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:Ht,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n,this.textures[s].isData3DTexture!==!0&&(this.textures[s].isArrayTexture=this.textures[s].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new gs(s)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},dn=class extends Oa{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},nr=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=kt,this.minFilter=kt,this.wrapR=Fn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Ba=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=kt,this.minFilter=kt,this.wrapR=Fn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Et=class i{static{i.prototype.isMatrix4=!0}constructor(e,t,n,s,r,a,o,l,c,h,u,d,f,x,b,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c,h,u,d,f,x,b,m)}set(e,t,n,s,r,a,o,l,c,h,u,d,f,x,b,m){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=a,p[9]=o,p[13]=l,p[2]=c,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=x,p[11]=b,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,s=1/ts.setFromMatrixColumn(e,0).length(),r=1/ts.setFromMatrixColumn(e,1).length(),a=1/ts.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=a*h,f=a*u,x=o*h,b=o*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=f+x*c,t[5]=d-b*c,t[9]=-o*l,t[2]=b-d*c,t[6]=x+f*c,t[10]=a*l}else if(e.order==="YXZ"){let d=l*h,f=l*u,x=c*h,b=c*u;t[0]=d+b*o,t[4]=x*o-f,t[8]=a*c,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-x,t[6]=b+d*o,t[10]=a*l}else if(e.order==="ZXY"){let d=l*h,f=l*u,x=c*h,b=c*u;t[0]=d-b*o,t[4]=-a*u,t[8]=x+f*o,t[1]=f+x*o,t[5]=a*h,t[9]=b-d*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){let d=a*h,f=a*u,x=o*h,b=o*u;t[0]=l*h,t[4]=x*c-f,t[8]=d*c+b,t[1]=l*u,t[5]=b*c+d,t[9]=f*c-x,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){let d=a*l,f=a*c,x=o*l,b=o*c;t[0]=l*h,t[4]=b-d*u,t[8]=x*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=f*u+x,t[10]=d-b*u}else if(e.order==="XZY"){let d=a*l,f=a*c,x=o*l,b=o*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+b,t[5]=a*h,t[9]=f*u-x,t[2]=x*u-f,t[6]=o*h,t[10]=b*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(hf,e,uf)}lookAt(e,t,n){let s=this.elements;return ln.subVectors(e,t),ln.lengthSq()===0&&(ln.z=1),ln.normalize(),ai.crossVectors(n,ln),ai.lengthSq()===0&&(Math.abs(n.z)===1?ln.x+=1e-4:ln.z+=1e-4,ln.normalize(),ai.crossVectors(n,ln)),ai.normalize(),Qr.crossVectors(ln,ai),s[0]=ai.x,s[4]=Qr.x,s[8]=ln.x,s[1]=ai.y,s[5]=Qr.y,s[9]=ln.y,s[2]=ai.z,s[6]=Qr.z,s[10]=ln.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],f=n[13],x=n[2],b=n[6],m=n[10],p=n[14],S=n[3],w=n[7],y=n[11],A=n[15],R=s[0],C=s[4],_=s[8],E=s[12],P=s[1],I=s[5],k=s[9],Y=s[13],J=s[2],O=s[6],$=s[10],V=s[14],ie=s[3],he=s[7],xe=s[11],ce=s[15];return r[0]=a*R+o*P+l*J+c*ie,r[4]=a*C+o*I+l*O+c*he,r[8]=a*_+o*k+l*$+c*xe,r[12]=a*E+o*Y+l*V+c*ce,r[1]=h*R+u*P+d*J+f*ie,r[5]=h*C+u*I+d*O+f*he,r[9]=h*_+u*k+d*$+f*xe,r[13]=h*E+u*Y+d*V+f*ce,r[2]=x*R+b*P+m*J+p*ie,r[6]=x*C+b*I+m*O+p*he,r[10]=x*_+b*k+m*$+p*xe,r[14]=x*E+b*Y+m*V+p*ce,r[3]=S*R+w*P+y*J+A*ie,r[7]=S*C+w*I+y*O+A*he,r[11]=S*_+w*k+y*$+A*xe,r[15]=S*E+w*Y+y*V+A*ce,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],f=e[14],x=e[3],b=e[7],m=e[11],p=e[15],S=l*f-c*d,w=o*f-c*u,y=o*d-l*u,A=a*f-c*h,R=a*d-l*h,C=a*u-o*h;return t*(b*S-m*w+p*y)-n*(x*S-m*A+p*R)+s*(x*w-b*A+p*C)-r*(x*y-b*R+m*C)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[1],a=e[5],o=e[9],l=e[2],c=e[6],h=e[10];return t*(a*h-o*c)-n*(r*h-o*l)+s*(r*c-a*l)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],f=e[11],x=e[12],b=e[13],m=e[14],p=e[15],S=t*o-n*a,w=t*l-s*a,y=t*c-r*a,A=n*l-s*o,R=n*c-r*o,C=s*c-r*l,_=h*b-u*x,E=h*m-d*x,P=h*p-f*x,I=u*m-d*b,k=u*p-f*b,Y=d*p-f*m,J=S*Y-w*k+y*I+A*P-R*E+C*_;if(J===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let O=1/J;return e[0]=(o*Y-l*k+c*I)*O,e[1]=(s*k-n*Y-r*I)*O,e[2]=(b*C-m*R+p*A)*O,e[3]=(d*R-u*C-f*A)*O,e[4]=(l*P-a*Y-c*E)*O,e[5]=(t*Y-s*P+r*E)*O,e[6]=(m*y-x*C-p*w)*O,e[7]=(h*C-d*y+f*w)*O,e[8]=(a*k-o*P+c*_)*O,e[9]=(n*P-t*k-r*_)*O,e[10]=(x*R-b*y+p*S)*O,e[11]=(u*y-h*R-f*S)*O,e[12]=(o*E-a*I-l*_)*O,e[13]=(t*I-n*E+s*_)*O,e[14]=(b*w-x*A-m*S)*O,e[15]=(h*A-u*w+d*S)*O,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,l=e.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-s*l,c*l+s*o,0,c*o+s*l,h*o+n,h*l-s*a,0,c*l-s*o,h*l+s*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,a=t._y,o=t._z,l=t._w,c=r+r,h=a+a,u=o+o,d=r*c,f=r*h,x=r*u,b=a*h,m=a*u,p=o*u,S=l*c,w=l*h,y=l*u,A=n.x,R=n.y,C=n.z;return s[0]=(1-(b+p))*A,s[1]=(f+y)*A,s[2]=(x-w)*A,s[3]=0,s[4]=(f-y)*R,s[5]=(1-(d+p))*R,s[6]=(m+S)*R,s[7]=0,s[8]=(x+w)*C,s[9]=(m-S)*C,s[10]=(1-(d+b))*C,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements;e.x=s[12],e.y=s[13],e.z=s[14];let r=this.determinantAffine();if(r===0)return n.set(1,1,1),t.identity(),this;let a=ts.set(s[0],s[1],s[2]).length(),o=ts.set(s[4],s[5],s[6]).length(),l=ts.set(s[8],s[9],s[10]).length();r<0&&(a=-a),Sn.copy(this);let c=1/a,h=1/o,u=1/l;return Sn.elements[0]*=c,Sn.elements[1]*=c,Sn.elements[2]*=c,Sn.elements[4]*=h,Sn.elements[5]*=h,Sn.elements[6]*=h,Sn.elements[8]*=u,Sn.elements[9]*=u,Sn.elements[10]*=u,t.setFromRotationMatrix(Sn),n.x=a,n.y=o,n.z=l,this}makePerspective(e,t,n,s,r,a,o=Tn,l=!1){let c=this.elements,h=2*r/(t-e),u=2*r/(n-s),d=(t+e)/(t-e),f=(n+s)/(n-s),x,b;if(l)x=r/(a-r),b=a*r/(a-r);else if(o===Tn)x=-(a+r)/(a-r),b=-2*a*r/(a-r);else if(o===ps)x=-a/(a-r),b=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=x,c[14]=b,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=Tn,l=!1){let c=this.elements,h=2/(t-e),u=2/(n-s),d=-(t+e)/(t-e),f=-(n+s)/(n-s),x,b;if(l)x=1/(a-r),b=a/(a-r);else if(o===Tn)x=-2/(a-r),b=-(a+r)/(a-r);else if(o===ps)x=-1/(a-r),b=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=x,c[14]=b,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},ts=new U,Sn=new Et,hf=new U(0,0,0),uf=new U(1,1,1),ai=new U,Qr=new U,ln=new U,Fh=new Et,Nh=new Un,Kn=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],h=s[9],u=s[2],d=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin(ft(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-ft(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(ft(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-ft(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(ft(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-ft(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:tt("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Fh.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Fh,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Nh.setFromEuler(this),this.setFromQuaternion(Nh,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Kn.DEFAULT_ORDER="XYZ";var ir=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},df=0,Dh=new U,ns=new Un,Wn=new Et,ea=new U,Gs=new U,ff=new U,pf=new Un,Uh=new U(1,0,0),Oh=new U(0,1,0),Bh=new U(0,0,1),zh={type:"added"},mf={type:"removed"},is={type:"childadded",child:null},wl={type:"childremoved",child:null},Ut=class i extends Dn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:df++}),this.uuid=Rs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new U,t=new Kn,n=new Un,s=new U(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Et},normalMatrix:{value:new rt}}),this.matrix=new Et,this.matrixWorld=new Et,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ir,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return ns.setFromAxisAngle(e,t),this.quaternion.multiply(ns),this}rotateOnWorldAxis(e,t){return ns.setFromAxisAngle(e,t),this.quaternion.premultiply(ns),this}rotateX(e){return this.rotateOnAxis(Uh,e)}rotateY(e){return this.rotateOnAxis(Oh,e)}rotateZ(e){return this.rotateOnAxis(Bh,e)}translateOnAxis(e,t){return Dh.copy(e).applyQuaternion(this.quaternion),this.position.add(Dh.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Uh,e)}translateY(e){return this.translateOnAxis(Oh,e)}translateZ(e){return this.translateOnAxis(Bh,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Wn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ea.copy(e):ea.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),Gs.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Wn.lookAt(Gs,ea,this.up):Wn.lookAt(ea,Gs,this.up),this.quaternion.setFromRotationMatrix(Wn),s&&(Wn.extractRotation(s.matrixWorld),ns.setFromRotationMatrix(Wn),this.quaternion.premultiply(ns.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(it("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(zh),is.child=e,this.dispatchEvent(is),is.child=null):it("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(mf),wl.child=e,this.dispatchEvent(wl),wl.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Wn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Wn.multiply(e.parent.matrixWorld)),e.applyMatrix4(Wn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(zh),is.child=e,this.dispatchEvent(is),is.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Gs,e,ff),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Gs,pf,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,s=e.z,r=this.matrix.elements;r[12]+=t-r[0]*t-r[4]*n-r[8]*s,r[13]+=n-r[1]*t-r[5]*n-r[9]*s,r[14]+=s-r[2]*t-r[6]*n-r[10]*s}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let s=this.parent;if(e===!0&&s!==null&&s.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let r=this.children;for(let a=0,o=r.length;a<o;a++)r[a].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),this.static!==!1&&(s.static=this.static),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.pivot!==null&&(s.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(s.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(s.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(o=>({...o})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];r(e.shapes,u)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];s.animations.push(r(e.animations,l))}}if(t){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),x=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),x.length>0&&(n.nodes=x)}return n.object=s,n;function a(o){let l=[];for(let c in o){let h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};Ut.DEFAULT_UP=new U(0,1,0);Ut.DEFAULT_MATRIX_AUTO_UPDATE=!0;Ut.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var un=class extends Ut{constructor(){super(),this.isGroup=!0,this.type="Group"}},gf={type:"move"},xs=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new un,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new un,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new U,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new U),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new un,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new U,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new U,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let b of e.hand.values()){let m=t.getJointPose(b,n),p=this._getHandJoint(c,b);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,x=.005;c.inputState.pinching&&d>f+x?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=f-x&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(gf)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new un;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},zu={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},oi={h:0,s:0,l:0},ta={h:0,s:0,l:0};function El(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var dt=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=hn){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,mt.colorSpaceToWorking(this,t),this}setRGB(e,t,n,s=mt.workingColorSpace){return this.r=e,this.g=t,this.b=n,mt.colorSpaceToWorking(this,s),this}setHSL(e,t,n,s=mt.workingColorSpace){if(e=af(e,1),t=ft(t,0,1),n=ft(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=El(a,r,e+1/3),this.g=El(a,r,e),this.b=El(a,r,e-1/3)}return mt.colorSpaceToWorking(this,s),this}setStyle(e,t=hn){function n(r){r!==void 0&&parseFloat(r)<1&&tt("Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:tt("Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);tt("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=hn){let n=zu[e.toLowerCase()];return n!==void 0?this.setHex(n,t):tt("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Zn(e.r),this.g=Zn(e.g),this.b=Zn(e.b),this}copyLinearToSRGB(e){return this.r=fs(e.r),this.g=fs(e.g),this.b=fs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=hn){return mt.workingToColorSpace(qt.copy(this),e),Math.round(ft(qt.r*255,0,255))*65536+Math.round(ft(qt.g*255,0,255))*256+Math.round(ft(qt.b*255,0,255))}getHexString(e=hn){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=mt.workingColorSpace){mt.workingToColorSpace(qt.copy(this),t);let n=qt.r,s=qt.g,r=qt.b,a=Math.max(n,s,r),o=Math.min(n,s,r),l,c,h=(o+a)/2;if(o===a)l=0,c=0;else{let u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(s-r)/u+(s<r?6:0);break;case s:l=(r-n)/u+2;break;case r:l=(n-s)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=mt.workingColorSpace){return mt.workingToColorSpace(qt.copy(this),t),e.r=qt.r,e.g=qt.g,e.b=qt.b,e}getStyle(e=hn){mt.workingToColorSpace(qt.copy(this),e);let t=qt.r,n=qt.g,s=qt.b;return e!==hn?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(oi),this.setHSL(oi.h+e,oi.s+t,oi.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(oi),e.getHSL(ta);let n=yl(oi.h,ta.h,t),s=yl(oi.s,ta.s,t),r=yl(oi.l,ta.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},qt=new dt;dt.NAMES=zu;var sr=class extends Ut{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Kn,this.environmentIntensity=1,this.environmentRotation=new Kn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},wn=new U,Xn=new U,Tl=new U,qn=new U,ss=new U,rs=new U,kh=new U,Al=new U,Rl=new U,Cl=new U,Pl=new Rt,Il=new Rt,Ll=new Rt,di=class i{constructor(e=new U,t=new U,n=new U){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),wn.subVectors(e,t),s.cross(wn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){wn.subVectors(s,t),Xn.subVectors(n,t),Tl.subVectors(e,t);let a=wn.dot(wn),o=wn.dot(Xn),l=wn.dot(Tl),c=Xn.dot(Xn),h=Xn.dot(Tl),u=a*c-o*o;if(u===0)return r.set(0,0,0),null;let d=1/u,f=(c*l-o*h)*d,x=(a*h-o*l)*d;return r.set(1-f-x,x,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,qn)===null?!1:qn.x>=0&&qn.y>=0&&qn.x+qn.y<=1}static getInterpolation(e,t,n,s,r,a,o,l){return this.getBarycoord(e,t,n,s,qn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,qn.x),l.addScaledVector(a,qn.y),l.addScaledVector(o,qn.z),l)}static getInterpolatedAttribute(e,t,n,s,r,a){return Pl.setScalar(0),Il.setScalar(0),Ll.setScalar(0),Pl.fromBufferAttribute(e,t),Il.fromBufferAttribute(e,n),Ll.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(Pl,r.x),a.addScaledVector(Il,r.y),a.addScaledVector(Ll,r.z),a}static isFrontFacing(e,t,n,s){return wn.subVectors(n,t),Xn.subVectors(e,t),wn.cross(Xn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return wn.subVectors(this.c,this.b),Xn.subVectors(this.a,this.b),wn.cross(Xn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,a,o;ss.subVectors(s,n),rs.subVectors(r,n),Al.subVectors(e,n);let l=ss.dot(Al),c=rs.dot(Al);if(l<=0&&c<=0)return t.copy(n);Rl.subVectors(e,s);let h=ss.dot(Rl),u=rs.dot(Rl);if(h>=0&&u<=h)return t.copy(s);let d=l*u-h*c;if(d<=0&&l>=0&&h<=0)return a=l/(l-h),t.copy(n).addScaledVector(ss,a);Cl.subVectors(e,r);let f=ss.dot(Cl),x=rs.dot(Cl);if(x>=0&&f<=x)return t.copy(r);let b=f*c-l*x;if(b<=0&&c>=0&&x<=0)return o=c/(c-x),t.copy(n).addScaledVector(rs,o);let m=h*x-f*u;if(m<=0&&u-h>=0&&f-x>=0)return kh.subVectors(r,s),o=(u-h)/(u-h+(f-x)),t.copy(s).addScaledVector(kh,o);let p=1/(m+b+d);return a=b*p,o=d*p,t.copy(n).addScaledVector(ss,a).addScaledVector(rs,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},On=class{constructor(e=new U(1/0,1/0,1/0),t=new U(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(En.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(En.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=En.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,En):En.fromBufferAttribute(r,a),En.applyMatrix4(e.matrixWorld),this.expandByPoint(En);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),na.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),na.copy(n.boundingBox)),na.applyMatrix4(e.matrixWorld),this.union(na)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,En),En.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ws),ia.subVectors(this.max,Ws),as.subVectors(e.a,Ws),os.subVectors(e.b,Ws),ls.subVectors(e.c,Ws),li.subVectors(os,as),ci.subVectors(ls,os),Ri.subVectors(as,ls);let t=[0,-li.z,li.y,0,-ci.z,ci.y,0,-Ri.z,Ri.y,li.z,0,-li.x,ci.z,0,-ci.x,Ri.z,0,-Ri.x,-li.y,li.x,0,-ci.y,ci.x,0,-Ri.y,Ri.x,0];return!Fl(t,as,os,ls,ia)||(t=[1,0,0,0,1,0,0,0,1],!Fl(t,as,os,ls,ia))?!1:(sa.crossVectors(li,ci),t=[sa.x,sa.y,sa.z],Fl(t,as,os,ls,ia))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,En).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(En).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Yn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Yn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Yn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Yn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Yn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Yn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Yn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Yn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Yn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Yn=[new U,new U,new U,new U,new U,new U,new U,new U],En=new U,na=new On,as=new U,os=new U,ls=new U,li=new U,ci=new U,Ri=new U,Ws=new U,ia=new U,sa=new U,Ci=new U;function Fl(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){Ci.fromArray(i,r);let o=s.x*Math.abs(Ci.x)+s.y*Math.abs(Ci.y)+s.z*Math.abs(Ci.z),l=e.dot(Ci),c=t.dot(Ci),h=n.dot(Ci);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}var Dt=new U,ra=new we,xf=0,tn=class extends Dn{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:xf++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Jl,this.updateRanges=[],this.gpuType=vn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)ra.fromBufferAttribute(this,t),ra.applyMatrix3(e),this.setXY(t,ra.x,ra.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Dt.fromBufferAttribute(this,t),Dt.applyMatrix3(e),this.setXYZ(t,Dt.x,Dt.y,Dt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Dt.fromBufferAttribute(this,t),Dt.applyMatrix4(e),this.setXYZ(t,Dt.x,Dt.y,Dt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Dt.fromBufferAttribute(this,t),Dt.applyNormalMatrix(e),this.setXYZ(t,Dt.x,Dt.y,Dt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Dt.fromBufferAttribute(this,t),Dt.transformDirection(e),this.setXYZ(t,Dt.x,Dt.y,Dt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Hs(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=en(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Hs(t,this.array)),t}setX(e,t){return this.normalized&&(t=en(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Hs(t,this.array)),t}setY(e,t){return this.normalized&&(t=en(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Hs(t,this.array)),t}setZ(e,t){return this.normalized&&(t=en(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Hs(t,this.array)),t}setW(e,t){return this.normalized&&(t=en(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=en(t,this.array),n=en(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=en(t,this.array),n=en(n,this.array),s=en(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=en(t,this.array),n=en(n,this.array),s=en(s,this.array),r=en(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Jl&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var rr=class extends tn{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var ar=class extends tn{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var ut=class extends tn{constructor(e,t,n){super(new Float32Array(e),t,n)}},_f=new On,Xs=new U,Nl=new U,pi=class{constructor(e=new U,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):_f.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Xs.subVectors(e,this.center);let t=Xs.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Xs,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Nl.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Xs.copy(e.center).add(Nl)),this.expandByPoint(Xs.copy(e.center).sub(Nl))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},yf=0,_n=new Et,Dl=new Ut,cs=new U,cn=new On,qs=new On,zt=new U,Nt=class i extends Dn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:yf++}),this.uuid=Rs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(sf(e)?ar:rr)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new rt().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return _n.makeRotationFromQuaternion(e),this.applyMatrix4(_n),this}rotateX(e){return _n.makeRotationX(e),this.applyMatrix4(_n),this}rotateY(e){return _n.makeRotationY(e),this.applyMatrix4(_n),this}rotateZ(e){return _n.makeRotationZ(e),this.applyMatrix4(_n),this}translate(e,t,n){return _n.makeTranslation(e,t,n),this.applyMatrix4(_n),this}scale(e,t,n){return _n.makeScale(e,t,n),this.applyMatrix4(_n),this}lookAt(e){return Dl.lookAt(e),Dl.updateMatrix(),this.applyMatrix4(Dl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(cs).negate(),this.translate(cs.x,cs.y,cs.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new ut(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&tt("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new On);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){it("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new U(-1/0,-1/0,-1/0),new U(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];cn.setFromBufferAttribute(r),this.morphTargetsRelative?(zt.addVectors(this.boundingBox.min,cn.min),this.boundingBox.expandByPoint(zt),zt.addVectors(this.boundingBox.max,cn.max),this.boundingBox.expandByPoint(zt)):(this.boundingBox.expandByPoint(cn.min),this.boundingBox.expandByPoint(cn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&it('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new pi);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){it("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new U,1/0);return}if(e){let n=this.boundingSphere.center;if(cn.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let o=t[r];qs.setFromBufferAttribute(o),this.morphTargetsRelative?(zt.addVectors(cn.min,qs.min),cn.expandByPoint(zt),zt.addVectors(cn.max,qs.max),cn.expandByPoint(zt)):(cn.expandByPoint(qs.min),cn.expandByPoint(qs.max))}cn.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)zt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(zt));if(t)for(let r=0,a=t.length;r<a;r++){let o=t[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)zt.fromBufferAttribute(o,c),l&&(cs.fromBufferAttribute(e,c),zt.add(cs)),s=Math.max(s,n.distanceToSquared(zt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&it('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){it("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv,a=this.getAttribute("tangent");(a===void 0||a.count!==n.count)&&(a=new tn(new Float32Array(4*n.count),4),this.setAttribute("tangent",a));let o=[],l=[];for(let _=0;_<n.count;_++)o[_]=new U,l[_]=new U;let c=new U,h=new U,u=new U,d=new we,f=new we,x=new we,b=new U,m=new U;function p(_,E,P){c.fromBufferAttribute(n,_),h.fromBufferAttribute(n,E),u.fromBufferAttribute(n,P),d.fromBufferAttribute(r,_),f.fromBufferAttribute(r,E),x.fromBufferAttribute(r,P),h.sub(c),u.sub(c),f.sub(d),x.sub(d);let I=1/(f.x*x.y-x.x*f.y);isFinite(I)&&(b.copy(h).multiplyScalar(x.y).addScaledVector(u,-f.y).multiplyScalar(I),m.copy(u).multiplyScalar(f.x).addScaledVector(h,-x.x).multiplyScalar(I),o[_].add(b),o[E].add(b),o[P].add(b),l[_].add(m),l[E].add(m),l[P].add(m))}let S=this.groups;S.length===0&&(S=[{start:0,count:e.count}]);for(let _=0,E=S.length;_<E;++_){let P=S[_],I=P.start,k=P.count;for(let Y=I,J=I+k;Y<J;Y+=3)p(e.getX(Y+0),e.getX(Y+1),e.getX(Y+2))}let w=new U,y=new U,A=new U,R=new U;function C(_){A.fromBufferAttribute(s,_),R.copy(A);let E=o[_];w.copy(E),w.sub(A.multiplyScalar(A.dot(E))).normalize(),y.crossVectors(R,E);let I=y.dot(l[_])<0?-1:1;a.setXYZW(_,w.x,w.y,w.z,I)}for(let _=0,E=S.length;_<E;++_){let P=S[_],I=P.start,k=P.count;for(let Y=I,J=I+k;Y<J;Y+=3)C(e.getX(Y+0)),C(e.getX(Y+1)),C(e.getX(Y+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==t.count)n=new tn(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let s=new U,r=new U,a=new U,o=new U,l=new U,c=new U,h=new U,u=new U;if(e)for(let d=0,f=e.count;d<f;d+=3){let x=e.getX(d+0),b=e.getX(d+1),m=e.getX(d+2);s.fromBufferAttribute(t,x),r.fromBufferAttribute(t,b),a.fromBufferAttribute(t,m),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),o.fromBufferAttribute(n,x),l.fromBufferAttribute(n,b),c.fromBufferAttribute(n,m),o.add(h),l.add(h),c.add(h),n.setXYZ(x,o.x,o.y,o.z),n.setXYZ(b,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let d=0,f=t.count;d<f;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)zt.fromBufferAttribute(e,t),zt.normalize(),e.setXYZ(t,zt.x,zt.y,zt.z)}toNonIndexed(){function e(o,l){let c=o.array,h=o.itemSize,u=o.normalized,d=new c.constructor(l.length*h),f=0,x=0;for(let b=0,m=l.length;b<m;b++){o.isInterleavedBufferAttribute?f=l[b]*o.data.stride+o.offset:f=l[b]*h;for(let p=0;p<h;p++)d[x++]=c[f++]}return new tn(d,h,u)}if(this.index===null)return tt("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let o in s){let l=s[o],c=e(l,n);t.setAttribute(o,c)}let r=this.morphAttributes;for(let o in r){let l=[],c=r[o];for(let h=0,u=c.length;h<u;h++){let d=c[h],f=e(d,n);l.push(f)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){let f=c[u];h.push(f.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let c in s){let h=s[c];this.setAttribute(c,h.clone(t))}let r=e.morphAttributes;for(let c in r){let h=[],u=r[c];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,h=a.length;c<h;c++){let u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}};var vf=0,jn=class extends Dn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:vf++}),this.uuid=Rs(),this.name="",this.type="Material",this.blending=Di,this.side=Jn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Sa,this.blendDst=wa,this.blendEquation=fi,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new dt(0,0,0),this.blendAlpha=0,this.depthFunc=Ui,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Zl,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Li,this.stencilZFail=Li,this.stencilZPass=Li,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){tt(`Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){tt(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector2&&n&&n.isVector2||s&&s.isEuler&&n&&n.isEuler||s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Di&&(n.blending=this.blending),this.side!==Jn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Sa&&(n.blendSrc=this.blendSrc),this.blendDst!==wa&&(n.blendDst=this.blendDst),this.blendEquation!==fi&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ui&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Zl&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Li&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Li&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Li&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.allowOverride===!1&&(n.allowOverride=!1),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let a=[];for(let o in r){let l=r[o];delete l.metadata,a.push(l)}return a}if(t){let r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new dt().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(typeof e.vertexColors=="number"?this.vertexColors=e.vertexColors>0:this.vertexColors=e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let n=e.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new we().fromArray(n)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new we().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var $n=new U,Ul=new U,aa=new U,hi=new U,Ol=new U,oa=new U,Bl=new U,za=class{constructor(e=new U,t=new U(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,$n)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=$n.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):($n.copy(this.origin).addScaledVector(this.direction,t),$n.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Ul.copy(e).add(t).multiplyScalar(.5),aa.copy(t).sub(e).normalize(),hi.copy(this.origin).sub(Ul);let r=e.distanceTo(t)*.5,a=-this.direction.dot(aa),o=hi.dot(this.direction),l=-hi.dot(aa),c=hi.lengthSq(),h=Math.abs(1-a*a),u,d,f,x;if(h>0)if(u=a*l-o,d=a*o-l,x=r*h,u>=0)if(d>=-x)if(d<=x){let b=1/h;u*=b,d*=b,f=u*(u+a*d+2*o)+d*(a*u+d+2*l)+c}else d=r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d=-r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d<=-x?(u=Math.max(0,-(-a*r+o)),d=u>0?-r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c):d<=x?(u=0,d=Math.min(Math.max(-r,-l),r),f=d*(d+2*l)+c):(u=Math.max(0,-(a*r+o)),d=u>0?r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c);else d=a>0?-r:r,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(Ul).addScaledVector(aa,d),f}intersectSphere(e,t){$n.subVectors(e.center,this.origin);let n=$n.dot(this.direction),s=$n.dot($n)-n*n,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,s=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,s=(e.min.x-d.x)*c),h>=0?(r=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),u>=0?(o=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||o>s)||((o>n||n!==n)&&(n=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,$n)!==null}intersectTriangle(e,t,n,s,r){Ol.subVectors(t,e),oa.subVectors(n,e),Bl.crossVectors(Ol,oa);let a=this.direction.dot(Bl),o;if(a>0){if(s)return null;o=1}else if(a<0)o=-1,a=-a;else return null;hi.subVectors(this.origin,e);let l=o*this.direction.dot(oa.crossVectors(hi,oa));if(l<0)return null;let c=o*this.direction.dot(Ol.cross(hi));if(c<0||l+c>a)return null;let h=-o*hi.dot(Bl);return h<0?null:this.at(h/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Bn=class extends jn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new dt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Kn,this.combine=co,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Vh=new Et,Pi=new za,la=new pi,Hh=new U,ca=new U,ha=new U,ua=new U,zl=new U,da=new U,Gh=new U,fa=new U,vt=class extends Ut{constructor(e=new Nt,t=new Bn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){da.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=o[l],u=r[l];h!==0&&(zl.fromBufferAttribute(u,e),a?da.addScaledVector(zl,h):da.addScaledVector(zl.sub(t),h))}t.add(da)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),la.copy(n.boundingSphere),la.applyMatrix4(r),Pi.copy(e.ray).recast(e.near),!(la.containsPoint(Pi.origin)===!1&&(Pi.intersectSphere(la,Hh)===null||Pi.origin.distanceToSquared(Hh)>(e.far-e.near)**2))&&(Vh.copy(r).invert(),Pi.copy(e.ray).applyMatrix4(Vh),!(n.boundingBox!==null&&Pi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Pi)))}_computeIntersections(e,t,n){let s,r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,f=r.drawRange;if(o!==null)if(Array.isArray(a))for(let x=0,b=d.length;x<b;x++){let m=d[x],p=a[m.materialIndex],S=Math.max(m.start,f.start),w=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let y=S,A=w;y<A;y+=3){let R=o.getX(y),C=o.getX(y+1),_=o.getX(y+2);s=pa(this,p,e,n,c,h,u,R,C,_),s&&(s.faceIndex=Math.floor(y/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let x=Math.max(0,f.start),b=Math.min(o.count,f.start+f.count);for(let m=x,p=b;m<p;m+=3){let S=o.getX(m),w=o.getX(m+1),y=o.getX(m+2);s=pa(this,a,e,n,c,h,u,S,w,y),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let x=0,b=d.length;x<b;x++){let m=d[x],p=a[m.materialIndex],S=Math.max(m.start,f.start),w=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let y=S,A=w;y<A;y+=3){let R=y,C=y+1,_=y+2;s=pa(this,p,e,n,c,h,u,R,C,_),s&&(s.faceIndex=Math.floor(y/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let x=Math.max(0,f.start),b=Math.min(l.count,f.start+f.count);for(let m=x,p=b;m<p;m+=3){let S=m,w=m+1,y=m+2;s=pa(this,a,e,n,c,h,u,S,w,y),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}};function bf(i,e,t,n,s,r,a,o){let l;if(e.side===Zt?l=n.intersectTriangle(a,r,s,!0,o):l=n.intersectTriangle(s,r,a,e.side===Jn,o),l===null)return null;fa.copy(o),fa.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(fa);return c<t.near||c>t.far?null:{distance:c,point:fa.clone(),object:i}}function pa(i,e,t,n,s,r,a,o,l,c){i.getVertexPosition(o,ca),i.getVertexPosition(l,ha),i.getVertexPosition(c,ua);let h=bf(i,e,t,n,ca,ha,ua,Gh);if(h){let u=new U;di.getBarycoord(Gh,ca,ha,ua,u),s&&(h.uv=di.getInterpolatedAttribute(s,o,l,c,u,new we)),r&&(h.uv1=di.getInterpolatedAttribute(r,o,l,c,u,new we)),a&&(h.normal=di.getInterpolatedAttribute(a,o,l,c,u,new U),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a:o,b:l,c,normal:new U,materialIndex:0};di.getNormal(ca,ha,ua,d.normal),h.face=d,h.barycoord=u}return h}var or=class extends nn{constructor(e=null,t=1,n=1,s,r,a,o,l,c=kt,h=kt,u,d){super(null,a,o,l,c,h,s,r,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var lr=class extends tn{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},hs=new Et,Wh=new Et,ma=[],Xh=new On,Mf=new Et,Ys=new vt,$s=new pi,Oi=class extends vt{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new lr(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,Mf)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new On),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,hs),Xh.copy(e.boundingBox).applyMatrix4(hs),this.boundingBox.union(Xh)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new pi),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,hs),$s.copy(e.boundingSphere).applyMatrix4(hs),this.boundingSphere.union($s)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,a=e*r+1;for(let o=0;o<n.length;o++)n[o]=s[a+o]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Ys.geometry=this.geometry,Ys.material=this.material,Ys.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),$s.copy(this.boundingSphere),$s.applyMatrix4(n),e.ray.intersectsSphere($s)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,hs),Wh.multiplyMatrices(n,hs),Ys.matrixWorld=Wh,Ys.raycast(e,ma);for(let a=0,o=ma.length;a<o;a++){let l=ma[a];l.instanceId=r,l.object=this,t.push(l)}ma.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new lr(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new or(new Float32Array(s*this.count),s,this.count,xo,vn));let r=this.morphTexture.source.data.data,a=0;for(let c=0;c<n.length;c++)a+=n[c];let o=this.geometry.morphTargetsRelative?1:1-a,l=s*e;return r[l]=o,r.set(n,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},kl=new U,Sf=new U,wf=new rt,Ln=class{constructor(e=new U(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=kl.subVectors(n,t).cross(Sf.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let s=e.delta(kl),r=this.normal.dot(s);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/r;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(s,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||wf.getNormalMatrix(e),s=this.coplanarPoint(kl).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Ii=new pi,Ef=new we(.5,.5),ga=new U,_s=class{constructor(e=new Ln,t=new Ln,n=new Ln,s=new Ln,r=new Ln,a=new Ln){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Tn,n=!1){let s=this.planes,r=e.elements,a=r[0],o=r[1],l=r[2],c=r[3],h=r[4],u=r[5],d=r[6],f=r[7],x=r[8],b=r[9],m=r[10],p=r[11],S=r[12],w=r[13],y=r[14],A=r[15];if(s[0].setComponents(c-a,f-h,p-x,A-S).normalize(),s[1].setComponents(c+a,f+h,p+x,A+S).normalize(),s[2].setComponents(c+o,f+u,p+b,A+w).normalize(),s[3].setComponents(c-o,f-u,p-b,A-w).normalize(),n)s[4].setComponents(l,d,m,y).normalize(),s[5].setComponents(c-l,f-d,p-m,A-y).normalize();else if(s[4].setComponents(c-l,f-d,p-m,A-y).normalize(),t===Tn)s[5].setComponents(c+l,f+d,p+m,A+y).normalize();else if(t===ps)s[5].setComponents(l,d,m,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Ii.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Ii.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Ii)}intersectsSprite(e){Ii.center.set(0,0,0);let t=Ef.distanceTo(e.center);return Ii.radius=.7071067811865476+t,Ii.applyMatrix4(e.matrixWorld),this.intersectsSphere(Ii)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(ga.x=s.normal.x>0?e.max.x:e.min.x,ga.y=s.normal.y>0?e.max.y:e.min.y,ga.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(ga)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var cr=class extends nn{constructor(e=[],t=yi,n,s,r,a,o,l,c,h){super(e,t,n,s,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}};var Qn=class extends nn{constructor(e,t,n=Rn,s,r,a,o=kt,l=kt,c,h=Nn,u=1){if(h!==Nn&&h!==bi)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let d={width:e,height:t,depth:u};super(d,s,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new gs(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},ka=class extends Qn{constructor(e,t=Rn,n=yi,s,r,a=kt,o=kt,l,c=Nn){let h={width:e,height:e,depth:1},u=[h,h,h,h,h,h];super(e,e,t,n,s,r,a,o,l,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},hr=class extends nn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Yt=class i extends Nt{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let l=[],c=[],h=[],u=[],d=0,f=0;x("z","y","x",-1,-1,n,t,e,a,r,0),x("z","y","x",1,-1,n,t,-e,a,r,1),x("x","z","y",1,1,e,n,t,s,a,2),x("x","z","y",1,-1,e,n,-t,s,a,3),x("x","y","z",1,-1,e,t,n,s,r,4),x("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ut(c,3)),this.setAttribute("normal",new ut(h,3)),this.setAttribute("uv",new ut(u,2));function x(b,m,p,S,w,y,A,R,C,_,E){let P=y/C,I=A/_,k=y/2,Y=A/2,J=R/2,O=C+1,$=_+1,V=0,ie=0,he=new U;for(let xe=0;xe<$;xe++){let ce=xe*I-Y;for(let pe=0;pe<O;pe++){let nt=pe*P-k;he[b]=nt*S,he[m]=ce*w,he[p]=J,c.push(he.x,he.y,he.z),he[b]=0,he[m]=0,he[p]=R>0?1:-1,h.push(he.x,he.y,he.z),u.push(pe/C),u.push(1-xe/_),V+=1}}for(let xe=0;xe<_;xe++)for(let ce=0;ce<C;ce++){let pe=d+ce+O*xe,nt=d+ce+O*(xe+1),st=d+(ce+1)+O*(xe+1),qe=d+(ce+1)+O*xe;l.push(pe,nt,qe),l.push(nt,st,qe),ie+=6}o.addGroup(f,ie,E),f+=ie,d+=V}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}},ur=class i extends Nt{constructor(e=1,t=1,n=4,s=8,r=1){super(),this.type="CapsuleGeometry",this.parameters={radius:e,height:t,capSegments:n,radialSegments:s,heightSegments:r},t=Math.max(0,t),n=Math.max(1,Math.floor(n)),s=Math.max(3,Math.floor(s)),r=Math.max(1,Math.floor(r));let a=[],o=[],l=[],c=[],h=t/2,u=Math.PI/2*e,d=t,f=2*u+d,x=n*2+r,b=s+1,m=new U,p=new U;for(let S=0;S<=x;S++){let w=0,y=0,A=0,R=0;if(S<=n){let E=S/n,P=E*Math.PI/2;y=-h-e*Math.cos(P),A=e*Math.sin(P),R=-e*Math.cos(P),w=E*u}else if(S<=n+r){let E=(S-n)/r;y=-h+E*t,A=e,R=0,w=u+E*d}else{let E=(S-n-r)/n,P=E*Math.PI/2;y=h+e*Math.sin(P),A=e*Math.cos(P),R=e*Math.sin(P),w=u+d+E*u}let C=Math.max(0,Math.min(1,w/f)),_=0;S===0?_=.5/s:S===x&&(_=-.5/s);for(let E=0;E<=s;E++){let P=E/s,I=P*Math.PI*2,k=Math.sin(I),Y=Math.cos(I);p.x=-A*Y,p.y=y,p.z=A*k,o.push(p.x,p.y,p.z),m.set(-A*Y,R,A*k),m.normalize(),l.push(m.x,m.y,m.z),c.push(P+_,C)}if(S>0){let E=(S-1)*b;for(let P=0;P<s;P++){let I=E+P,k=E+P+1,Y=S*b+P,J=S*b+P+1;a.push(I,k,Y),a.push(k,J,Y)}}}this.setIndex(a),this.setAttribute("position",new ut(o,3)),this.setAttribute("normal",new ut(l,3)),this.setAttribute("uv",new ut(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.height,e.capSegments,e.radialSegments,e.heightSegments)}},mi=class i extends Nt{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],a=[],o=[],l=[],c=new U,h=new we;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){let f=n+u/t*s;c.x=e*Math.cos(f),c.y=e*Math.sin(f),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new ut(a,3)),this.setAttribute("normal",new ut(o,3)),this.setAttribute("uv",new ut(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}},sn=class i extends Nt{constructor(e=1,t=1,n=1,s=32,r=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:a,thetaStart:o,thetaLength:l};let c=this;s=Math.floor(s),r=Math.floor(r);let h=[],u=[],d=[],f=[],x=0,b=[],m=n/2,p=0;S(),a===!1&&(e>0&&w(!0),t>0&&w(!1)),this.setIndex(h),this.setAttribute("position",new ut(u,3)),this.setAttribute("normal",new ut(d,3)),this.setAttribute("uv",new ut(f,2));function S(){let y=new U,A=new U,R=0,C=(t-e)/n;for(let _=0;_<=r;_++){let E=[],P=_/r,I=P*(t-e)+e;for(let k=0;k<=s;k++){let Y=k/s,J=Y*l+o,O=Math.sin(J),$=Math.cos(J);A.x=I*O,A.y=-P*n+m,A.z=I*$,u.push(A.x,A.y,A.z),y.set(O,C,$).normalize(),d.push(y.x,y.y,y.z),f.push(Y,1-P),E.push(x++)}b.push(E)}for(let _=0;_<s;_++)for(let E=0;E<r;E++){let P=b[E][_],I=b[E+1][_],k=b[E+1][_+1],Y=b[E][_+1];(e>0||E!==0)&&(h.push(P,I,Y),R+=3),(t>0||E!==r-1)&&(h.push(I,k,Y),R+=3)}c.addGroup(p,R,0),p+=R}function w(y){let A=x,R=new we,C=new U,_=0,E=y===!0?e:t,P=y===!0?1:-1;for(let k=1;k<=s;k++)u.push(0,m*P,0),d.push(0,P,0),f.push(.5,.5),x++;let I=x;for(let k=0;k<=s;k++){let J=k/s*l+o,O=Math.cos(J),$=Math.sin(J);C.x=E*$,C.y=m*P,C.z=E*O,u.push(C.x,C.y,C.z),d.push(0,P,0),R.x=O*.5+.5,R.y=$*.5*P+.5,f.push(R.x,R.y),x++}for(let k=0;k<s;k++){let Y=A+k,J=I+k;y===!0?h.push(J,J+1,Y):h.push(J+1,J,Y),_+=3}c.addGroup(p,_,y===!0?1:2),p+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},ys=class i extends sn{constructor(e=1,t=1,n=32,s=1,r=!1,a=0,o=Math.PI*2){super(0,e,t,n,s,r,a,o),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:a,thetaLength:o}}static fromJSON(e){return new i(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},Va=class i extends Nt{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};let r=[],a=[];o(s),c(n),h(),this.setAttribute("position",new ut(r,3)),this.setAttribute("normal",new ut(r.slice(),3)),this.setAttribute("uv",new ut(a,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function o(S){let w=new U,y=new U,A=new U;for(let R=0;R<t.length;R+=3)f(t[R+0],w),f(t[R+1],y),f(t[R+2],A),l(w,y,A,S)}function l(S,w,y,A){let R=A+1,C=[];for(let _=0;_<=R;_++){C[_]=[];let E=S.clone().lerp(y,_/R),P=w.clone().lerp(y,_/R),I=R-_;for(let k=0;k<=I;k++)k===0&&_===R?C[_][k]=E:C[_][k]=E.clone().lerp(P,k/I)}for(let _=0;_<R;_++)for(let E=0;E<2*(R-_)-1;E++){let P=Math.floor(E/2);E%2===0?(d(C[_][P+1]),d(C[_+1][P]),d(C[_][P])):(d(C[_][P+1]),d(C[_+1][P+1]),d(C[_+1][P]))}}function c(S){let w=new U;for(let y=0;y<r.length;y+=3)w.x=r[y+0],w.y=r[y+1],w.z=r[y+2],w.normalize().multiplyScalar(S),r[y+0]=w.x,r[y+1]=w.y,r[y+2]=w.z}function h(){let S=new U;for(let w=0;w<r.length;w+=3){S.x=r[w+0],S.y=r[w+1],S.z=r[w+2];let y=m(S)/2/Math.PI+.5,A=p(S)/Math.PI+.5;a.push(y,1-A)}x(),u()}function u(){for(let S=0;S<a.length;S+=6){let w=a[S+0],y=a[S+2],A=a[S+4],R=Math.max(w,y,A),C=Math.min(w,y,A);R>.9&&C<.1&&(w<.2&&(a[S+0]+=1),y<.2&&(a[S+2]+=1),A<.2&&(a[S+4]+=1))}}function d(S){r.push(S.x,S.y,S.z)}function f(S,w){let y=S*3;w.x=e[y+0],w.y=e[y+1],w.z=e[y+2]}function x(){let S=new U,w=new U,y=new U,A=new U,R=new we,C=new we,_=new we;for(let E=0,P=0;E<r.length;E+=9,P+=6){S.set(r[E+0],r[E+1],r[E+2]),w.set(r[E+3],r[E+4],r[E+5]),y.set(r[E+6],r[E+7],r[E+8]),R.set(a[P+0],a[P+1]),C.set(a[P+2],a[P+3]),_.set(a[P+4],a[P+5]),A.copy(S).add(w).add(y).divideScalar(3);let I=m(A);b(R,P+0,S,I),b(C,P+2,w,I),b(_,P+4,y,I)}}function b(S,w,y,A){A<0&&S.x===1&&(a[w]=S.x-1),y.x===0&&y.z===0&&(a[w]=A/2/Math.PI+.5)}function m(S){return Math.atan2(S.z,-S.x)}function p(S){return Math.atan2(-S.y,Math.sqrt(S.x*S.x+S.z*S.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.vertices,e.indices,e.radius,e.detail)}};var fn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){tt("Curve: .getPoint() not implemented.")}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,s=this.getPoint(0),r=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),r+=n.distanceTo(s),t.push(r),s=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),s=0,r=n.length,a;t?a=t:a=e*n[r-1];let o=0,l=r-1,c;for(;o<=l;)if(s=Math.floor(o+(l-o)/2),c=n[s]-a,c<0)o=s+1;else if(c>0)l=s-1;else{l=s;break}if(s=l,n[s]===a)return s/(r-1);let h=n[s],d=n[s+1]-h,f=(a-h)/d;return(s+f)/(r-1)}getTangent(e,t){let s=e-1e-4,r=e+1e-4;s<0&&(s=0),r>1&&(r=1);let a=this.getPoint(s),o=this.getPoint(r),l=t||(a.isVector2?new we:new U);return l.copy(o).sub(a).normalize(),l}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new U,s=[],r=[],a=[],o=new U,l=new Et;for(let f=0;f<=e;f++){let x=f/e;s[f]=this.getTangentAt(x,new U)}r[0]=new U,a[0]=new U;let c=Number.MAX_VALUE,h=Math.abs(s[0].x),u=Math.abs(s[0].y),d=Math.abs(s[0].z);h<=c&&(c=h,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),o.crossVectors(s[0],n).normalize(),r[0].crossVectors(s[0],o),a[0].crossVectors(s[0],r[0]);for(let f=1;f<=e;f++){if(r[f]=r[f-1].clone(),a[f]=a[f-1].clone(),o.crossVectors(s[f-1],s[f]),o.length()>Number.EPSILON){o.normalize();let x=Math.acos(ft(s[f-1].dot(s[f]),-1,1));r[f].applyMatrix4(l.makeRotationAxis(o,x))}a[f].crossVectors(s[f],r[f])}if(t===!0){let f=Math.acos(ft(r[0].dot(r[e]),-1,1));f/=e,s[0].dot(o.crossVectors(r[0],r[e]))>0&&(f=-f);for(let x=1;x<=e;x++)r[x].applyMatrix4(l.makeRotationAxis(s[x],f*x)),a[x].crossVectors(s[x],r[x])}return{tangents:s,normals:r,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},vs=class extends fn{constructor(e=0,t=0,n=1,s=1,r=0,a=Math.PI*2,o=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=s,this.aStartAngle=r,this.aEndAngle=a,this.aClockwise=o,this.aRotation=l}getPoint(e,t=new we){let n=t,s=Math.PI*2,r=this.aEndAngle-this.aStartAngle,a=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=s;for(;r>s;)r-=s;r<Number.EPSILON&&(a?r=0:r=s),this.aClockwise===!0&&!a&&(r===s?r=-s:r=r-s);let o=this.aStartAngle+e*r,l=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){let h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=l-this.aX,f=c-this.aY;l=d*h-f*u+this.aX,c=d*u+f*h+this.aY}return n.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Ha=class extends vs{constructor(e,t,n,s,r,a){super(e,t,n,n,s,r,a),this.isArcCurve=!0,this.type="ArcCurve"}};function Ec(){let i=0,e=0,t=0,n=0;function s(r,a,o,l){i=r,e=o,t=-3*r+3*a-2*o-l,n=2*r-2*a+o+l}return{initCatmullRom:function(r,a,o,l,c){s(a,o,c*(o-r),c*(l-a))},initNonuniformCatmullRom:function(r,a,o,l,c,h,u){let d=(a-r)/c-(o-r)/(c+h)+(o-a)/h,f=(o-a)/h-(l-a)/(h+u)+(l-o)/u;d*=h,f*=h,s(a,o,d,f)},calc:function(r){let a=r*r,o=a*r;return i+e*r+t*a+n*o}}}var qh=new U,Yh=new U,Vl=new Ec,Hl=new Ec,Gl=new Ec,Ga=class extends fn{constructor(e=[],t=!1,n="centripetal",s=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=s}getPoint(e,t=new U){let n=t,s=this.points,r=s.length,a=(r-(this.closed?0:1))*e,o=Math.floor(a),l=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/r)+1)*r:l===0&&o===r-1&&(o=r-2,l=1);let c,h;this.closed||o>0?c=s[(o-1)%r]:(Yh.subVectors(s[0],s[1]).add(s[0]),c=Yh);let u=s[o%r],d=s[(o+1)%r];if(this.closed||o+2<r?h=s[(o+2)%r]:(qh.subVectors(s[r-1],s[r-2]).add(s[r-1]),h=qh),this.curveType==="centripetal"||this.curveType==="chordal"){let f=this.curveType==="chordal"?.5:.25,x=Math.pow(c.distanceToSquared(u),f),b=Math.pow(u.distanceToSquared(d),f),m=Math.pow(d.distanceToSquared(h),f);b<1e-4&&(b=1),x<1e-4&&(x=b),m<1e-4&&(m=b),Vl.initNonuniformCatmullRom(c.x,u.x,d.x,h.x,x,b,m),Hl.initNonuniformCatmullRom(c.y,u.y,d.y,h.y,x,b,m),Gl.initNonuniformCatmullRom(c.z,u.z,d.z,h.z,x,b,m)}else this.curveType==="catmullrom"&&(Vl.initCatmullRom(c.x,u.x,d.x,h.x,this.tension),Hl.initCatmullRom(c.y,u.y,d.y,h.y,this.tension),Gl.initCatmullRom(c.z,u.z,d.z,h.z,this.tension));return n.set(Vl.calc(l),Hl.calc(l),Gl.calc(l)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new U().fromArray(s))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function $h(i,e,t,n,s){let r=(n-e)*.5,a=(s-t)*.5,o=i*i,l=i*o;return(2*t-2*n+r+a)*l+(-3*t+3*n-2*r-a)*o+r*i+t}function Tf(i,e){let t=1-i;return t*t*e}function Af(i,e){return 2*(1-i)*i*e}function Rf(i,e){return i*i*e}function Js(i,e,t,n){return Tf(i,e)+Af(i,t)+Rf(i,n)}function Cf(i,e){let t=1-i;return t*t*t*e}function Pf(i,e){let t=1-i;return 3*t*t*i*e}function If(i,e){return 3*(1-i)*i*i*e}function Lf(i,e){return i*i*i*e}function Ks(i,e,t,n,s){return Cf(i,e)+Pf(i,t)+If(i,n)+Lf(i,s)}var dr=class extends fn{constructor(e=new we,t=new we,n=new we,s=new we){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new we){let n=t,s=this.v0,r=this.v1,a=this.v2,o=this.v3;return n.set(Ks(e,s.x,r.x,a.x,o.x),Ks(e,s.y,r.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Wa=class extends fn{constructor(e=new U,t=new U,n=new U,s=new U){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new U){let n=t,s=this.v0,r=this.v1,a=this.v2,o=this.v3;return n.set(Ks(e,s.x,r.x,a.x,o.x),Ks(e,s.y,r.y,a.y,o.y),Ks(e,s.z,r.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},fr=class extends fn{constructor(e=new we,t=new we){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new we){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new we){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Xa=class extends fn{constructor(e=new U,t=new U){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new U){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new U){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},pr=class extends fn{constructor(e=new we,t=new we,n=new we){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new we){let n=t,s=this.v0,r=this.v1,a=this.v2;return n.set(Js(e,s.x,r.x,a.x),Js(e,s.y,r.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},qa=class extends fn{constructor(e=new U,t=new U,n=new U){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new U){let n=t,s=this.v0,r=this.v1,a=this.v2;return n.set(Js(e,s.x,r.x,a.x),Js(e,s.y,r.y,a.y),Js(e,s.z,r.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},mr=class extends fn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new we){let n=t,s=this.points,r=(s.length-1)*e,a=Math.floor(r),o=r-a,l=s[a===0?a:a-1],c=s[a],h=s[a>s.length-2?s.length-1:a+1],u=s[a>s.length-3?s.length-1:a+2];return n.set($h(o,l.x,c.x,h.x,u.x),$h(o,l.y,c.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new we().fromArray(s))}return this}},Kl=Object.freeze({__proto__:null,ArcCurve:Ha,CatmullRomCurve3:Ga,CubicBezierCurve:dr,CubicBezierCurve3:Wa,EllipseCurve:vs,LineCurve:fr,LineCurve3:Xa,QuadraticBezierCurve:pr,QuadraticBezierCurve3:qa,SplineCurve:mr}),Ya=class extends fn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let n=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new Kl[n](t,e))}return this}getPoint(e,t){let n=e*this.getLength(),s=this.getCurveLengths(),r=0;for(;r<s.length;){if(s[r]>=n){let a=s[r]-n,o=this.curves[r],l=o.getLength(),c=l===0?0:1-a/l;return o.getPointAt(c,t)}r++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let n=0,s=this.curves.length;n<s;n++)t+=this.curves[n].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],n;for(let s=0,r=this.curves;s<r.length;s++){let a=r[s],o=a.isEllipseCurve?e*2:a.isLineCurve||a.isLineCurve3?1:a.isSplineCurve?e*a.points.length:e,l=a.getPoints(o);for(let c=0;c<l.length;c++){let h=l[c];n&&n.equals(h)||(t.push(h),n=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(s.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,n=this.curves.length;t<n;t++){let s=this.curves[t];e.curves.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(new Kl[s.type]().fromJSON(s))}return this}},gr=class extends Ya{constructor(e){super(),this.type="Path",this.currentPoint=new we,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,n=e.length;t<n;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let n=new fr(this.currentPoint.clone(),new we(e,t));return this.curves.push(n),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,n,s){let r=new pr(this.currentPoint.clone(),new we(e,t),new we(n,s));return this.curves.push(r),this.currentPoint.set(n,s),this}bezierCurveTo(e,t,n,s,r,a){let o=new dr(this.currentPoint.clone(),new we(e,t),new we(n,s),new we(r,a));return this.curves.push(o),this.currentPoint.set(r,a),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),n=new mr(t);return this.curves.push(n),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,n,s,r,a){let o=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+o,t+l,n,s,r,a),this}absarc(e,t,n,s,r,a){return this.absellipse(e,t,n,n,s,r,a),this}ellipse(e,t,n,s,r,a,o,l){let c=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+c,t+h,n,s,r,a,o,l),this}absellipse(e,t,n,s,r,a,o,l){let c=new vs(e,t,n,s,r,a,o,l);if(this.curves.length>0){let u=c.getPoint(0);u.equals(this.currentPoint)||this.lineTo(u.x,u.y)}this.curves.push(c);let h=c.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},bs=class extends gr{constructor(e){super(e),this.uuid=Rs(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let n=0,s=this.holes.length;n<s;n++)t[n]=this.holes[n].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,n=this.holes.length;t<n;t++){let s=this.holes[t];e.holes.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(new gr().fromJSON(s))}return this}};function Ff(i,e,t=2){let n=e&&e.length,s=n?e[0]*t:i.length,r=ku(i,0,s,t,!0),a=[];if(!r||r.next===r.prev)return a;let o,l,c;if(n&&(r=Bf(i,e,r,t)),i.length>80*t){o=i[0],l=i[1];let h=o,u=l;for(let d=t;d<s;d+=t){let f=i[d],x=i[d+1];f<o&&(o=f),x<l&&(l=x),f>h&&(h=f),x>u&&(u=x)}c=Math.max(h-o,u-l),c=c!==0?32767/c:0}return xr(r,a,t,o,l,c,0),a}function ku(i,e,t,n,s){let r;if(s===Zf(i,e,t,n)>0)for(let a=e;a<t;a+=n)r=Zh(a/n|0,i[a],i[a+1],r);else for(let a=t-n;a>=e;a-=n)r=Zh(a/n|0,i[a],i[a+1],r);return r&&Ms(r,r.next)&&(yr(r),r=r.next),r}function Bi(i,e){if(!i)return i;e||(e=i);let t=i,n;do if(n=!1,!t.steiner&&(Ms(t,t.next)||Ct(t.prev,t,t.next)===0)){if(yr(t),t=e=t.prev,t===t.next)break;n=!0}else t=t.next;while(n||t!==e);return e}function xr(i,e,t,n,s,r,a){if(!i)return;!a&&r&&Gf(i,n,s,r);let o=i;for(;i.prev!==i.next;){let l=i.prev,c=i.next;if(r?Df(i,n,s,r):Nf(i)){e.push(l.i,i.i,c.i),yr(i),i=c.next,o=c.next;continue}if(i=c,i===o){a?a===1?(i=Uf(Bi(i),e),xr(i,e,t,n,s,r,2)):a===2&&Of(i,e,t,n,s,r):xr(Bi(i),e,t,n,s,r,1);break}}}function Nf(i){let e=i.prev,t=i,n=i.next;if(Ct(e,t,n)>=0)return!1;let s=e.x,r=t.x,a=n.x,o=e.y,l=t.y,c=n.y,h=Math.min(s,r,a),u=Math.min(o,l,c),d=Math.max(s,r,a),f=Math.max(o,l,c),x=n.next;for(;x!==e;){if(x.x>=h&&x.x<=d&&x.y>=u&&x.y<=f&&Zs(s,o,r,l,a,c,x.x,x.y)&&Ct(x.prev,x,x.next)>=0)return!1;x=x.next}return!0}function Df(i,e,t,n){let s=i.prev,r=i,a=i.next;if(Ct(s,r,a)>=0)return!1;let o=s.x,l=r.x,c=a.x,h=s.y,u=r.y,d=a.y,f=Math.min(o,l,c),x=Math.min(h,u,d),b=Math.max(o,l,c),m=Math.max(h,u,d),p=jl(f,x,e,t,n),S=jl(b,m,e,t,n),w=i.prevZ,y=i.nextZ;for(;w&&w.z>=p&&y&&y.z<=S;){if(w.x>=f&&w.x<=b&&w.y>=x&&w.y<=m&&w!==s&&w!==a&&Zs(o,h,l,u,c,d,w.x,w.y)&&Ct(w.prev,w,w.next)>=0||(w=w.prevZ,y.x>=f&&y.x<=b&&y.y>=x&&y.y<=m&&y!==s&&y!==a&&Zs(o,h,l,u,c,d,y.x,y.y)&&Ct(y.prev,y,y.next)>=0))return!1;y=y.nextZ}for(;w&&w.z>=p;){if(w.x>=f&&w.x<=b&&w.y>=x&&w.y<=m&&w!==s&&w!==a&&Zs(o,h,l,u,c,d,w.x,w.y)&&Ct(w.prev,w,w.next)>=0)return!1;w=w.prevZ}for(;y&&y.z<=S;){if(y.x>=f&&y.x<=b&&y.y>=x&&y.y<=m&&y!==s&&y!==a&&Zs(o,h,l,u,c,d,y.x,y.y)&&Ct(y.prev,y,y.next)>=0)return!1;y=y.nextZ}return!0}function Uf(i,e){let t=i;do{let n=t.prev,s=t.next.next;!Ms(n,s)&&Hu(n,t,t.next,s)&&_r(n,s)&&_r(s,n)&&(e.push(n.i,t.i,s.i),yr(t),yr(t.next),t=i=s),t=t.next}while(t!==i);return Bi(t)}function Of(i,e,t,n,s,r){let a=i;do{let o=a.next.next;for(;o!==a.prev;){if(a.i!==o.i&&qf(a,o)){let l=Gu(a,o);a=Bi(a,a.next),l=Bi(l,l.next),xr(a,e,t,n,s,r,0),xr(l,e,t,n,s,r,0);return}o=o.next}a=a.next}while(a!==i)}function Bf(i,e,t,n){let s=[];for(let r=0,a=e.length;r<a;r++){let o=e[r]*n,l=r<a-1?e[r+1]*n:i.length,c=ku(i,o,l,n,!1);c===c.next&&(c.steiner=!0),s.push(Xf(c))}s.sort(zf);for(let r=0;r<s.length;r++)t=kf(s[r],t);return t}function zf(i,e){let t=i.x-e.x;if(t===0&&(t=i.y-e.y,t===0)){let n=(i.next.y-i.y)/(i.next.x-i.x),s=(e.next.y-e.y)/(e.next.x-e.x);t=n-s}return t}function kf(i,e){let t=Vf(i,e);if(!t)return e;let n=Gu(t,i);return Bi(n,n.next),Bi(t,t.next)}function Vf(i,e){let t=e,n=i.x,s=i.y,r=-1/0,a;if(Ms(i,t))return t;do{if(Ms(i,t.next))return t.next;if(s<=t.y&&s>=t.next.y&&t.next.y!==t.y){let u=t.x+(s-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(u<=n&&u>r&&(r=u,a=t.x<t.next.x?t:t.next,u===n))return a}t=t.next}while(t!==e);if(!a)return null;let o=a,l=a.x,c=a.y,h=1/0;t=a;do{if(n>=t.x&&t.x>=l&&n!==t.x&&Vu(s<c?n:r,s,l,c,s<c?r:n,s,t.x,t.y)){let u=Math.abs(s-t.y)/(n-t.x);_r(t,i)&&(u<h||u===h&&(t.x>a.x||t.x===a.x&&Hf(a,t)))&&(a=t,h=u)}t=t.next}while(t!==o);return a}function Hf(i,e){return Ct(i.prev,i,e.prev)<0&&Ct(e.next,i,i.next)<0}function Gf(i,e,t,n){let s=i;do s.z===0&&(s.z=jl(s.x,s.y,e,t,n)),s.prevZ=s.prev,s.nextZ=s.next,s=s.next;while(s!==i);s.prevZ.nextZ=null,s.prevZ=null,Wf(s)}function Wf(i){let e,t=1;do{let n=i,s;i=null;let r=null;for(e=0;n;){e++;let a=n,o=0;for(let c=0;c<t&&(o++,a=a.nextZ,!!a);c++);let l=t;for(;o>0||l>0&&a;)o!==0&&(l===0||!a||n.z<=a.z)?(s=n,n=n.nextZ,o--):(s=a,a=a.nextZ,l--),r?r.nextZ=s:i=s,s.prevZ=r,r=s;n=a}r.nextZ=null,t*=2}while(e>1);return i}function jl(i,e,t,n,s){return i=(i-t)*s|0,e=(e-n)*s|0,i=(i|i<<8)&16711935,i=(i|i<<4)&252645135,i=(i|i<<2)&858993459,i=(i|i<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,i|e<<1}function Xf(i){let e=i,t=i;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==i);return t}function Vu(i,e,t,n,s,r,a,o){return(s-a)*(e-o)>=(i-a)*(r-o)&&(i-a)*(n-o)>=(t-a)*(e-o)&&(t-a)*(r-o)>=(s-a)*(n-o)}function Zs(i,e,t,n,s,r,a,o){return!(i===a&&e===o)&&Vu(i,e,t,n,s,r,a,o)}function qf(i,e){return i.next.i!==e.i&&i.prev.i!==e.i&&!Yf(i,e)&&(_r(i,e)&&_r(e,i)&&$f(i,e)&&(Ct(i.prev,i,e.prev)||Ct(i,e.prev,e))||Ms(i,e)&&Ct(i.prev,i,i.next)>0&&Ct(e.prev,e,e.next)>0)}function Ct(i,e,t){return(e.y-i.y)*(t.x-e.x)-(e.x-i.x)*(t.y-e.y)}function Ms(i,e){return i.x===e.x&&i.y===e.y}function Hu(i,e,t,n){let s=_a(Ct(i,e,t)),r=_a(Ct(i,e,n)),a=_a(Ct(t,n,i)),o=_a(Ct(t,n,e));return!!(s!==r&&a!==o||s===0&&xa(i,t,e)||r===0&&xa(i,n,e)||a===0&&xa(t,i,n)||o===0&&xa(t,e,n))}function xa(i,e,t){return e.x<=Math.max(i.x,t.x)&&e.x>=Math.min(i.x,t.x)&&e.y<=Math.max(i.y,t.y)&&e.y>=Math.min(i.y,t.y)}function _a(i){return i>0?1:i<0?-1:0}function Yf(i,e){let t=i;do{if(t.i!==i.i&&t.next.i!==i.i&&t.i!==e.i&&t.next.i!==e.i&&Hu(t,t.next,i,e))return!0;t=t.next}while(t!==i);return!1}function _r(i,e){return Ct(i.prev,i,i.next)<0?Ct(i,e,i.next)>=0&&Ct(i,i.prev,e)>=0:Ct(i,e,i.prev)<0||Ct(i,i.next,e)<0}function $f(i,e){let t=i,n=!1,s=(i.x+e.x)/2,r=(i.y+e.y)/2;do t.y>r!=t.next.y>r&&t.next.y!==t.y&&s<(t.next.x-t.x)*(r-t.y)/(t.next.y-t.y)+t.x&&(n=!n),t=t.next;while(t!==i);return n}function Gu(i,e){let t=Ql(i.i,i.x,i.y),n=Ql(e.i,e.x,e.y),s=i.next,r=e.prev;return i.next=e,e.prev=i,t.next=s,s.prev=t,n.next=t,t.prev=n,r.next=n,n.prev=r,n}function Zh(i,e,t,n){let s=Ql(i,e,t);return n?(s.next=n.next,s.prev=n,n.next.prev=s,n.next=s):(s.prev=s,s.next=s),s}function yr(i){i.next.prev=i.prev,i.prev.next=i.next,i.prevZ&&(i.prevZ.nextZ=i.nextZ),i.nextZ&&(i.nextZ.prevZ=i.prevZ)}function Ql(i,e,t){return{i,x:e,y:t,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function Zf(i,e,t,n){let s=0;for(let r=e,a=t-n;r<t;r+=n)s+=(i[a]-i[r])*(i[r+1]+i[a+1]),a=r;return s}var ec=class{static triangulate(e,t,n=2){return Ff(e,t,n)}},Fi=class i{static area(e){let t=e.length,n=0;for(let s=t-1,r=0;r<t;s=r++)n+=e[s].x*e[r].y-e[r].x*e[s].y;return n*.5}static isClockWise(e){return i.area(e)<0}static triangulateShape(e,t){let n=[],s=[],r=[];Jh(e),Kh(n,e);let a=e.length;t.forEach(Jh);for(let l=0;l<t.length;l++)s.push(a),a+=t[l].length,Kh(n,t[l]);let o=ec.triangulate(n,s);for(let l=0;l<o.length;l+=3)r.push(o.slice(l,l+3));return r}};function Jh(i){let e=i.length;e>2&&i[e-1].equals(i[0])&&i.pop()}function Kh(i,e){for(let t=0;t<e.length;t++)i.push(e[t].x),i.push(e[t].y)}var vr=class i extends Nt{constructor(e=new bs([new we(.5,.5),new we(-.5,.5),new we(-.5,-.5),new we(.5,-.5)]),t={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:t},e=Array.isArray(e)?e:[e];let n=this,s=[],r=[];for(let o=0,l=e.length;o<l;o++){let c=e[o];a(c)}this.setAttribute("position",new ut(s,3)),this.setAttribute("uv",new ut(r,2)),this.computeVertexNormals();function a(o){let l=[],c=t.curveSegments!==void 0?t.curveSegments:12,h=t.steps!==void 0?t.steps:1,u=t.depth!==void 0?t.depth:1,d=t.bevelEnabled!==void 0?t.bevelEnabled:!0,f=t.bevelThickness!==void 0?t.bevelThickness:.2,x=t.bevelSize!==void 0?t.bevelSize:f-.1,b=t.bevelOffset!==void 0?t.bevelOffset:0,m=t.bevelSegments!==void 0?t.bevelSegments:3,p=t.extrudePath,S=t.UVGenerator!==void 0?t.UVGenerator:Jf,w,y=!1,A,R,C,_;if(p){w=p.getSpacedPoints(h),y=!0,d=!1;let H=p.isCatmullRomCurve3?p.closed:!1;A=p.computeFrenetFrames(h,H),R=new U,C=new U,_=new U}d||(m=0,f=0,x=0,b=0);let E=o.extractPoints(c),P=E.shape,I=E.holes;if(!Fi.isClockWise(P)){P=P.reverse();for(let H=0,K=I.length;H<K;H++){let te=I[H];Fi.isClockWise(te)&&(I[H]=te.reverse())}}function Y(H){let te=10000000000000001e-36,ge=H[0];for(let de=1;de<=H.length;de++){let We=de%H.length,He=H[We],je=He.x-ge.x,L=He.y-ge.y,T=je*je+L*L,j=Math.max(Math.abs(He.x),Math.abs(He.y),Math.abs(ge.x),Math.abs(ge.y)),ue=te*j*j;if(T<=ue){H.splice(We,1),de--;continue}ge=He}}Y(P),I.forEach(Y);let J=I.length,O=P;for(let H=0;H<J;H++){let K=I[H];P=P.concat(K)}function $(H,K,te){return K||it("ExtrudeGeometry: vec does not exist"),H.clone().addScaledVector(K,te)}let V=P.length;function ie(H,K,te){let ge,de,We,He=H.x-K.x,je=H.y-K.y,L=te.x-H.x,T=te.y-H.y,j=He*He+je*je,ue=He*T-je*L;if(Math.abs(ue)>Number.EPSILON){let M=Math.sqrt(j),g=Math.sqrt(L*L+T*T),F=K.x-je/M,z=K.y+He/M,G=te.x-T/g,re=te.y+L/g,fe=((G-F)*T-(re-z)*L)/(He*T-je*L);ge=F+He*fe-H.x,de=z+je*fe-H.y;let Q=ge*ge+de*de;if(Q<=2)return new we(ge,de);We=Math.sqrt(Q/2)}else{let M=!1;He>Number.EPSILON?L>Number.EPSILON&&(M=!0):He<-Number.EPSILON?L<-Number.EPSILON&&(M=!0):Math.sign(je)===Math.sign(T)&&(M=!0),M?(ge=-je,de=He,We=Math.sqrt(j)):(ge=He,de=je,We=Math.sqrt(j/2))}return new we(ge/We,de/We)}let he=[];for(let H=0,K=O.length,te=K-1,ge=H+1;H<K;H++,te++,ge++)te===K&&(te=0),ge===K&&(ge=0),he[H]=ie(O[H],O[te],O[ge]);let xe=[],ce,pe=he.concat();for(let H=0,K=J;H<K;H++){let te=I[H];ce=[];for(let ge=0,de=te.length,We=de-1,He=ge+1;ge<de;ge++,We++,He++)We===de&&(We=0),He===de&&(He=0),ce[ge]=ie(te[ge],te[We],te[He]);xe.push(ce),pe=pe.concat(ce)}let nt;if(m===0)nt=Fi.triangulateShape(O,I);else{let H=[],K=[];for(let te=0;te<m;te++){let ge=te/m,de=f*Math.cos(ge*Math.PI/2),We=x*Math.sin(ge*Math.PI/2)+b;for(let He=0,je=O.length;He<je;He++){let L=$(O[He],he[He],We);Ne(L.x,L.y,-de),ge===0&&H.push(L)}for(let He=0,je=J;He<je;He++){let L=I[He];ce=xe[He];let T=[];for(let j=0,ue=L.length;j<ue;j++){let M=$(L[j],ce[j],We);Ne(M.x,M.y,-de),ge===0&&T.push(M)}ge===0&&K.push(T)}}nt=Fi.triangulateShape(H,K)}let st=nt.length,qe=x+b;for(let H=0;H<V;H++){let K=d?$(P[H],pe[H],qe):P[H];y?(C.copy(A.normals[0]).multiplyScalar(K.x),R.copy(A.binormals[0]).multiplyScalar(K.y),_.copy(w[0]).add(C).add(R),Ne(_.x,_.y,_.z)):Ne(K.x,K.y,0)}for(let H=1;H<=h;H++)for(let K=0;K<V;K++){let te=d?$(P[K],pe[K],qe):P[K];y?(C.copy(A.normals[H]).multiplyScalar(te.x),R.copy(A.binormals[H]).multiplyScalar(te.y),_.copy(w[H]).add(C).add(R),Ne(_.x,_.y,_.z)):Ne(te.x,te.y,u/h*H)}for(let H=m-1;H>=0;H--){let K=H/m,te=f*Math.cos(K*Math.PI/2),ge=x*Math.sin(K*Math.PI/2)+b;for(let de=0,We=O.length;de<We;de++){let He=$(O[de],he[de],ge);Ne(He.x,He.y,u+te)}for(let de=0,We=I.length;de<We;de++){let He=I[de];ce=xe[de];for(let je=0,L=He.length;je<L;je++){let T=$(He[je],ce[je],ge);y?Ne(T.x,T.y+w[h-1].y,w[h-1].x+te):Ne(T.x,T.y,u+te)}}}ee(),ve();function ee(){let H=s.length/3;if(d){let K=0,te=V*K;for(let ge=0;ge<st;ge++){let de=nt[ge];Pe(de[2]+te,de[1]+te,de[0]+te)}K=h+m*2,te=V*K;for(let ge=0;ge<st;ge++){let de=nt[ge];Pe(de[0]+te,de[1]+te,de[2]+te)}}else{for(let K=0;K<st;K++){let te=nt[K];Pe(te[2],te[1],te[0])}for(let K=0;K<st;K++){let te=nt[K];Pe(te[0]+V*h,te[1]+V*h,te[2]+V*h)}}n.addGroup(H,s.length/3-H,0)}function ve(){let H=s.length/3,K=0;le(O,K),K+=O.length;for(let te=0,ge=I.length;te<ge;te++){let de=I[te];le(de,K),K+=de.length}n.addGroup(H,s.length/3-H,1)}function le(H,K){let te=H.length;for(;--te>=0;){let ge=te,de=te-1;de<0&&(de=H.length-1);for(let We=0,He=h+m*2;We<He;We++){let je=V*We,L=V*(We+1),T=K+ge+je,j=K+de+je,ue=K+de+L,M=K+ge+L;Ee(T,j,ue,M)}}}function Ne(H,K,te){l.push(H),l.push(K),l.push(te)}function Pe(H,K,te){Ye(H),Ye(K),Ye(te);let ge=s.length/3,de=S.generateTopUV(n,s,ge-3,ge-2,ge-1);Ue(de[0]),Ue(de[1]),Ue(de[2])}function Ee(H,K,te,ge){Ye(H),Ye(K),Ye(ge),Ye(K),Ye(te),Ye(ge);let de=s.length/3,We=S.generateSideWallUV(n,s,de-6,de-3,de-2,de-1);Ue(We[0]),Ue(We[1]),Ue(We[3]),Ue(We[1]),Ue(We[2]),Ue(We[3])}function Ye(H){s.push(l[H*3+0]),s.push(l[H*3+1]),s.push(l[H*3+2])}function Ue(H){r.push(H.x),r.push(H.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes,n=this.parameters.options;return Kf(t,n,e)}static fromJSON(e,t){let n=[];for(let r=0,a=e.shapes.length;r<a;r++){let o=t[e.shapes[r]];n.push(o)}let s=e.options.extrudePath;return s!==void 0&&(e.options.extrudePath=new Kl[s.type]().fromJSON(s)),new i(n,e.options)}},Jf={generateTopUV:function(i,e,t,n,s){let r=e[t*3],a=e[t*3+1],o=e[n*3],l=e[n*3+1],c=e[s*3],h=e[s*3+1];return[new we(r,a),new we(o,l),new we(c,h)]},generateSideWallUV:function(i,e,t,n,s,r){let a=e[t*3],o=e[t*3+1],l=e[t*3+2],c=e[n*3],h=e[n*3+1],u=e[n*3+2],d=e[s*3],f=e[s*3+1],x=e[s*3+2],b=e[r*3],m=e[r*3+1],p=e[r*3+2];return Math.abs(o-h)<Math.abs(a-c)?[new we(a,1-l),new we(c,1-u),new we(d,1-x),new we(b,1-p)]:[new we(o,1-l),new we(h,1-u),new we(f,1-x),new we(m,1-p)]}};function Kf(i,e,t){if(t.shapes=[],Array.isArray(i))for(let n=0,s=i.length;n<s;n++){let r=i[n];t.shapes.push(r.uuid)}else t.shapes.push(i.uuid);return t.options=Object.assign({},e),e.extrudePath!==void 0&&(t.options.extrudePath=e.extrudePath.toJSON()),t}var Ss=class i extends Va{constructor(e=1,t=0){let n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}};var yn=class i extends Nt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,a=t/2,o=Math.floor(n),l=Math.floor(s),c=o+1,h=l+1,u=e/o,d=t/l,f=[],x=[],b=[],m=[];for(let p=0;p<h;p++){let S=p*d-a;for(let w=0;w<c;w++){let y=w*u-r;x.push(y,-S,0),b.push(0,0,1),m.push(w/o),m.push(1-p/l)}}for(let p=0;p<l;p++)for(let S=0;S<o;S++){let w=S+c*p,y=S+c*(p+1),A=S+1+c*(p+1),R=S+1+c*p;f.push(w,y,R),f.push(y,A,R)}this.setIndex(f),this.setAttribute("position",new ut(x,3)),this.setAttribute("normal",new ut(b,3)),this.setAttribute("uv",new ut(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}};var zi=class i extends Nt{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let l=Math.min(a+o,Math.PI),c=0,h=[],u=new U,d=new U,f=[],x=[],b=[],m=[];for(let p=0;p<=n;p++){let S=[],w=p/n,y=a+w*o,A=e*Math.cos(y),R=Math.sqrt(e*e-A*A),C=0;p===0&&a===0?C=.5/t:p===n&&l===Math.PI&&(C=-.5/t);for(let _=0;_<=t;_++){let E=_/t,P=s+E*r;u.x=-R*Math.cos(P),u.y=A,u.z=R*Math.sin(P),x.push(u.x,u.y,u.z),d.copy(u).normalize(),b.push(d.x,d.y,d.z),m.push(E+C,1-w),S.push(c++)}h.push(S)}for(let p=0;p<n;p++)for(let S=0;S<t;S++){let w=h[p][S+1],y=h[p][S],A=h[p+1][S],R=h[p+1][S+1];(p!==0||a>0)&&f.push(w,y,R),(p!==n-1||l<Math.PI)&&f.push(y,A,R)}this.setIndex(f),this.setAttribute("position",new ut(x,3)),this.setAttribute("normal",new ut(b,3)),this.setAttribute("uv",new ut(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var br=class i extends Nt{constructor(e=1,t=.4,n=12,s=48,r=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:s,arc:r,thetaStart:a,thetaLength:o},n=Math.floor(n),s=Math.floor(s);let l=[],c=[],h=[],u=[],d=new U,f=new U,x=new U;for(let b=0;b<=n;b++){let m=a+b/n*o;for(let p=0;p<=s;p++){let S=p/s*r;f.x=(e+t*Math.cos(m))*Math.cos(S),f.y=(e+t*Math.cos(m))*Math.sin(S),f.z=t*Math.sin(m),c.push(f.x,f.y,f.z),d.x=e*Math.cos(S),d.y=e*Math.sin(S),x.subVectors(f,d).normalize(),h.push(x.x,x.y,x.z),u.push(p/s),u.push(b/n)}}for(let b=1;b<=n;b++)for(let m=1;m<=s;m++){let p=(s+1)*b+m-1,S=(s+1)*(b-1)+m-1,w=(s+1)*(b-1)+m,y=(s+1)*b+m;l.push(p,S,y),l.push(S,w,y)}this.setIndex(l),this.setAttribute("position",new ut(c,3)),this.setAttribute("normal",new ut(h,3)),this.setAttribute("uv",new ut(u,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};var Mr=class extends jn{constructor(e){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new dt(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};function Hi(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];if(jh(s))s.isRenderTargetTexture?(tt("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone();else if(Array.isArray(s))if(jh(s[0])){let r=[];for(let a=0,o=s.length;a<o;a++)r[a]=s[a].clone();e[t][n]=r}else e[t][n]=s.slice();else e[t][n]=s}}return e}function $t(i){let e={};for(let t=0;t<i.length;t++){let n=Hi(i[t]);for(let s in n)e[s]=n[s]}return e}function jh(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function jf(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Tc(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:mt.workingColorSpace}var Wu={clone:Hi,merge:$t},Qf=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,ep=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,pn=class extends jn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Qf,this.fragmentShader=ep,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Hi(e.uniforms),this.uniformsGroups=jf(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let s=e.uniforms[n];switch(this.uniforms[n]={},s.type){case"t":this.uniforms[n].value=t[s.value]||null;break;case"c":this.uniforms[n].value=new dt().setHex(s.value);break;case"v2":this.uniforms[n].value=new we().fromArray(s.value);break;case"v3":this.uniforms[n].value=new U().fromArray(s.value);break;case"v4":this.uniforms[n].value=new Rt().fromArray(s.value);break;case"m3":this.uniforms[n].value=new rt().fromArray(s.value);break;case"m4":this.uniforms[n].value=new Et().fromArray(s.value);break;default:this.uniforms[n].value=s.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let n in e.extensions)this.extensions[n]=e.extensions[n];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},$a=class extends pn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}};var Sr=class extends jn{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new dt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new dt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ko,this.normalScale=new we(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Kn,this.combine=co,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Za=class extends jn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Au,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Ja=class extends jn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function ya(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}var gi=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let a;t:{i:if(!(e<s)){for(let o=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(r=s,s=t[++n],e<s)break e}a=t.length;break t}if(!(e>=r)){let o=t[1];e<o&&(n=2,r=o);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break e}a=n,n=0;break t}break n}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},Ka=class extends gi{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:ql,endingEnd:ql}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],l=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case Yl:r=e,o=2*t-n;break;case $l:r=s.length-2,o=t+s[r]-s[r+1];break;default:r=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case Yl:a=e,l=2*n-t;break;case $l:a=1,l=n+s[1]-s[0];break;default:a=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=a*h}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,x=(n-t)/(s-t),b=x*x,m=b*x,p=-d*m+2*d*b-d*x,S=(1+d)*m+(-1.5-2*d)*b+(-.5+d)*x+1,w=(-1-f)*m+(1.5+f)*b+.5*x,y=f*m-f*b;for(let A=0;A!==o;++A)r[A]=p*a[h+A]+S*a[c+A]+w*a[l+A]+y*a[u+A];return r}},ja=class extends gi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==o;++d)r[d]=a[c+d]*u+a[l+d]*h;return r}},Qa=class extends gi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},eo=class extends gi{interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this.inTangents,u=this.outTangents;if(!h||!u){let x=(n-t)/(s-t),b=1-x;for(let m=0;m!==o;++m)r[m]=a[c+m]*b+a[l+m]*x;return r}let d=o*2,f=e-1;for(let x=0;x!==o;++x){let b=a[c+x],m=a[l+x],p=f*d+x*2,S=u[p],w=u[p+1],y=e*d+x*2,A=h[y],R=h[y+1],C=(n-t)/(s-t),_,E,P,I,k;for(let Y=0;Y<8;Y++){_=C*C,E=_*C,P=1-C,I=P*P,k=I*P;let O=k*t+3*I*C*S+3*P*_*A+E*s-n;if(Math.abs(O)<1e-10)break;let $=3*I*(S-t)+6*P*C*(A-S)+3*_*(s-A);if(Math.abs($)<1e-10)break;C=C-O/$,C=Math.max(0,Math.min(1,C))}r[x]=k*b+3*I*C*w+3*P*_*R+E*m}return r}},mn=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=ya(t,this.TimeBufferType),this.values=ya(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:ya(e.times,Array),values:ya(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Qa(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new ja(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Ka(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new eo(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case js:t=this.InterpolantFactoryMethodDiscrete;break;case Na:t=this.InterpolantFactoryMethodLinear;break;case Ma:t=this.InterpolantFactoryMethodSmooth;break;case Xl:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return tt("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return js;case this.InterpolantFactoryMethodLinear:return Na;case this.InterpolantFactoryMethodSmooth:return Ma;case this.InterpolantFactoryMethodBezier:return Xl}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,a=s-1;for(;r!==s&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(it("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(it("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){it("KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){it("KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(s!==void 0&&rf(s))for(let o=0,l=s.length;o!==l;++o){let c=s[o];if(isNaN(c)){it("KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Ma,r=e.length-1,a=1;for(let o=1;o<r;++o){let l=!1,c=e[o],h=e[o+1];if(c!==h&&(o!==1||c!==e[0]))if(s)l=!0;else{let u=o*n,d=u-n,f=u+n;for(let x=0;x!==n;++x){let b=t[u+x];if(b!==t[d+x]||b!==t[f+x]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(r>0){e[a]=e[r];for(let o=r*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};mn.prototype.ValueTypeName="";mn.prototype.TimeBufferType=Float32Array;mn.prototype.ValueBufferType=Float32Array;mn.prototype.DefaultInterpolation=Na;var xi=class extends mn{constructor(e,t,n){super(e,t,n)}};xi.prototype.ValueTypeName="bool";xi.prototype.ValueBufferType=Array;xi.prototype.DefaultInterpolation=js;xi.prototype.InterpolantFactoryMethodLinear=void 0;xi.prototype.InterpolantFactoryMethodSmooth=void 0;var to=class extends mn{constructor(e,t,n,s){super(e,t,n,s)}};to.prototype.ValueTypeName="color";var no=class extends mn{constructor(e,t,n,s){super(e,t,n,s)}};no.prototype.ValueTypeName="number";var io=class extends gi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(s-t),c=e*o;for(let h=c+o;c!==h;c+=4)Un.slerpFlat(r,0,a,c-o,a,c,l);return r}},wr=class extends mn{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new io(this.times,this.values,this.getValueSize(),e)}};wr.prototype.ValueTypeName="quaternion";wr.prototype.InterpolantFactoryMethodSmooth=void 0;var _i=class extends mn{constructor(e,t,n){super(e,t,n)}};_i.prototype.ValueTypeName="string";_i.prototype.ValueBufferType=Array;_i.prototype.DefaultInterpolation=js;_i.prototype.InterpolantFactoryMethodLinear=void 0;_i.prototype.InterpolantFactoryMethodSmooth=void 0;var so=class extends mn{constructor(e,t,n,s){super(e,t,n,s)}};so.prototype.ValueTypeName="vector";var ro=class{constructor(e,t,n){let s=this,r=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(h){o++,r===!1&&s.onStart!==void 0&&s.onStart(h,a,o),r=!0},this.itemEnd=function(h){a++,s.onProgress!==void 0&&s.onProgress(h,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return h=h.normalize("NFC"),l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){let f=c[u],x=c[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return x}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Xu=new ro,ao=class{constructor(e){this.manager=e!==void 0?e:Xu,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};ao.DEFAULT_MATERIAL_NAME="__DEFAULT";var Er=class extends Ut{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new dt(e),this.intensity=t}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Tr=class extends Er{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Ut.DEFAULT_UP),this.updateMatrix(),this.groundColor=new dt(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},Wl=new Et,Qh=new U,eu=new U,tc=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new we(512,512),this.mapType=an,this.map=null,this.mapPass=null,this.matrix=new Et,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new _s,this._frameExtents=new we(1,1),this._viewportCount=1,this._viewports=[new Rt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Qh.setFromMatrixPosition(e.matrixWorld),t.position.copy(Qh),eu.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(eu),t.updateMatrixWorld(),Wl.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Wl,t.coordinateSystem,t.reversedDepth),t.coordinateSystem===ps||t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Wl)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},va=new U,ba=new Un,In=new U,Ar=class extends Ut{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Et,this.projectionMatrix=new Et,this.projectionMatrixInverse=new Et,this.coordinateSystem=Tn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(va,ba,In),In.x===1&&In.y===1&&In.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(va,ba,In.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(va,ba,In),In.x===1&&In.y===1&&In.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(va,ba,In.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},ui=new U,tu=new we,nu=new we,Vt=class extends Ar{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Da*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(_l*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Da*2*Math.atan(Math.tan(_l*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){ui.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(ui.x,ui.y).multiplyScalar(-e/ui.z),ui.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(ui.x,ui.y).multiplyScalar(-e/ui.z)}getViewSize(e,t){return this.getViewBounds(e,tu,nu),t.subVectors(nu,tu)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(_l*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,t-=a.offsetY*n/c,s*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}};var ws=class extends Ar{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,a=n+e,o=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},nc=class extends tc{constructor(){super(new ws(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Rr=class extends Er{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Ut.DEFAULT_UP),this.updateMatrix(),this.target=new Ut,this.shadow=new nc}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}};var us=-90,ds=1,oo=class extends Ut{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new Vt(us,ds,e,t);s.layers=this.layers,this.add(s);let r=new Vt(us,ds,e,t);r.layers=this.layers,this.add(r);let a=new Vt(us,ds,e,t);a.layers=this.layers,this.add(a);let o=new Vt(us,ds,e,t);o.layers=this.layers,this.add(o);let l=new Vt(us,ds,e,t);l.layers=this.layers,this.add(l);let c=new Vt(us,ds,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,l]=t;for(let c of t)this.remove(c);if(e===Tn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===ps)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),x=e.xr.enabled;e.xr.enabled=!1;let b=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let m=!1;e.isWebGLRenderer===!0?m=e.state.buffers.depth.getReversed():m=e.reversedDepthBuffer,e.setRenderTarget(n,0,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,r),e.setRenderTarget(n,1,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(n,4,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.generateMipmaps=b,e.setRenderTarget(n,5,s),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=x,n.texture.needsPMREMUpdate=!0}},lo=class extends Vt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Ac="\\[\\]\\.:\\/",tp=new RegExp("["+Ac+"]","g"),Rc="[^"+Ac+"]",np="[^"+Ac.replace("\\.","")+"]",ip=/((?:WC+[\/:])*)/.source.replace("WC",Rc),sp=/(WCOD+)?/.source.replace("WCOD",np),rp=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Rc),ap=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Rc),op=new RegExp("^"+ip+sp+rp+ap+"$"),lp=["material","materials","bones","map"],ic=class{constructor(e,t,n){let s=n||At.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},At=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(tp,"")}static parseTrackName(e){let t=op.exec(e);if(t===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);lp.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===t||o.uuid===t)return o;let l=n(o.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){tt("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){it("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){it("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){it("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){it("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){it("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){it("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){it("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[s];if(a===void 0){let c=t.nodeName;it("PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){it("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){it("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};At.Composite=ic;At.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};At.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};At.prototype.GetterByBindingType=[At.prototype._getValue_direct,At.prototype._getValue_array,At.prototype._getValue_arrayElement,At.prototype._getValue_toArray];At.prototype.SetterByBindingTypeAndVersioning=[[At.prototype._setValue_direct,At.prototype._setValue_direct_setNeedsUpdate,At.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[At.prototype._setValue_array,At.prototype._setValue_array_setNeedsUpdate,At.prototype._setValue_array_setMatrixWorldNeedsUpdate],[At.prototype._setValue_arrayElement,At.prototype._setValue_arrayElement_setNeedsUpdate,At.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[At.prototype._setValue_fromArray,At.prototype._setValue_fromArray_setNeedsUpdate,At.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var V_=new Float32Array(1);var sc=class i{static{i.prototype.isMatrix2=!0}constructor(e,t,n,s){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,s)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,s){let r=this.elements;return r[0]=e,r[2]=t,r[1]=n,r[3]=s,this}};function Cc(i,e,t,n){let s=cp(n);switch(t){case bc:return i*e;case xo:return i*e/s.components*s.byteLength;case _o:return i*e/s.components*s.byteLength;case Mi:return i*e*2/s.components*s.byteLength;case yo:return i*e*2/s.components*s.byteLength;case Mc:return i*e*3/s.components*s.byteLength;case bn:return i*e*4/s.components*s.byteLength;case vo:return i*e*4/s.components*s.byteLength;case Ir:case Lr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Fr:case Nr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Mo:case wo:return Math.max(i,16)*Math.max(e,8)/4;case bo:case So:return Math.max(i,8)*Math.max(e,8)/2;case Eo:case To:case Ro:case Co:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Ao:case Dr:case Po:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Io:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Lo:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case Fo:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case No:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case Do:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case Uo:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Oo:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case Bo:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case zo:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case ko:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Vo:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case Ho:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case Go:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Wo:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Xo:case qo:case Yo:return Math.ceil(i/4)*Math.ceil(e/4)*16;case $o:case Zo:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Ur:case Jo:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function cp(i){switch(i){case an:case xc:return{byteLength:1,components:1};case Ts:case _c:case kn:return{byteLength:2,components:1};case mo:case go:return{byteLength:2,components:4};case Rn:case po:case vn:return{byteLength:4,components:1};case yc:case vc:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"185"}}));typeof window<"u"&&(window.__THREE__?tt("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="185");/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function pd(){let i=null,e=!1,t=null,n=null;function s(r,a){t(r,a),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&i!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function up(i){let e=new WeakMap;function t(o,l){let c=o.array,h=o.usage,u=c.byteLength,d=i.createBuffer();i.bindBuffer(l,d),i.bufferData(l,c,h),o.onUploadCallback();let f;if(c instanceof Float32Array)f=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)f=i.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?f=i.HALF_FLOAT:f=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=i.SHORT;else if(c instanceof Uint32Array)f=i.UNSIGNED_INT;else if(c instanceof Int32Array)f=i.INT;else if(c instanceof Int8Array)f=i.BYTE;else if(c instanceof Uint8Array)f=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){let h=l.array,u=l.updateRanges;if(i.bindBuffer(c,o),u.length===0)i.bufferSubData(c,0,h);else{u.sort((f,x)=>f.start-x.start);let d=0;for(let f=1;f<u.length;f++){let x=u[d],b=u[f];b.start<=x.start+x.count+1?x.count=Math.max(x.count,b.start+b.count-x.start):(++d,u[d]=b)}u.length=d+1;for(let f=0,x=u.length;f<x;f++){let b=u[f];i.bufferSubData(c,b.start*h.BYTES_PER_ELEMENT,h,b.start,b.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}var dp=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,fp=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,pp=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,mp=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,gp=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,xp=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,_p=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,yp=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,vp=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,bp=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Mp=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Sp=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,wp=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Ep=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Tp=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Ap=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Rp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Cp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Pp=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Ip=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,Lp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,Fp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,Np=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,Dp=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Up=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Op=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,Bp=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,zp=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,kp=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Vp=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Hp="gl_FragColor = linearToOutputTexel( gl_FragColor );",Gp=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Wp=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,Xp=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,qp=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Yp=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,$p=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Zp=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Jp=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Kp=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,jp=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Qp=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,em=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,tm=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,nm=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,im=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,sm=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,rm=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,am=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,om=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lm=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,cm=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,hm=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,um=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,dm=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,fm=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,pm=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,mm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,gm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,xm=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,_m=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ym=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,vm=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,bm=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Mm=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Sm=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,wm=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Em=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Tm=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Am=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Rm=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Cm=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Pm=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Im=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Lm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Fm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Nm=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,Dm=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Um=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Om=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Bm=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,zm=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,km=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Vm=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,Hm=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Gm=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Wm=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Xm=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,qm=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Ym=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,$m=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,Zm=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Jm=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Km=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,jm=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Qm=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,eg=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,tg=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,ng=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,ig=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,sg=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,rg=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,ag=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,og=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,lg=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,cg=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,hg=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,ug=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,dg=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,fg=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,pg=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,mg=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,gg=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,xg=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_g=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,yg=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,vg=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,bg=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,Mg=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Sg=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wg=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Eg=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Tg=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Ag=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Rg=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Cg=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Pg=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Ig=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Lg=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Fg=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Ng=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Dg=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Ug=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Og=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Bg=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,zg=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,kg=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Vg=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Hg=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Gg=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Wg=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Xg=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ct={alphahash_fragment:dp,alphahash_pars_fragment:fp,alphamap_fragment:pp,alphamap_pars_fragment:mp,alphatest_fragment:gp,alphatest_pars_fragment:xp,aomap_fragment:_p,aomap_pars_fragment:yp,batching_pars_vertex:vp,batching_vertex:bp,begin_vertex:Mp,beginnormal_vertex:Sp,bsdfs:wp,iridescence_fragment:Ep,bumpmap_pars_fragment:Tp,clipping_planes_fragment:Ap,clipping_planes_pars_fragment:Rp,clipping_planes_pars_vertex:Cp,clipping_planes_vertex:Pp,color_fragment:Ip,color_pars_fragment:Lp,color_pars_vertex:Fp,color_vertex:Np,common:Dp,cube_uv_reflection_fragment:Up,defaultnormal_vertex:Op,displacementmap_pars_vertex:Bp,displacementmap_vertex:zp,emissivemap_fragment:kp,emissivemap_pars_fragment:Vp,colorspace_fragment:Hp,colorspace_pars_fragment:Gp,envmap_fragment:Wp,envmap_common_pars_fragment:Xp,envmap_pars_fragment:qp,envmap_pars_vertex:Yp,envmap_physical_pars_fragment:sm,envmap_vertex:$p,fog_vertex:Zp,fog_pars_vertex:Jp,fog_fragment:Kp,fog_pars_fragment:jp,gradientmap_pars_fragment:Qp,lightmap_pars_fragment:em,lights_lambert_fragment:tm,lights_lambert_pars_fragment:nm,lights_pars_begin:im,lights_toon_fragment:rm,lights_toon_pars_fragment:am,lights_phong_fragment:om,lights_phong_pars_fragment:lm,lights_physical_fragment:cm,lights_physical_pars_fragment:hm,lights_fragment_begin:um,lights_fragment_maps:dm,lights_fragment_end:fm,lightprobes_pars_fragment:pm,logdepthbuf_fragment:mm,logdepthbuf_pars_fragment:gm,logdepthbuf_pars_vertex:xm,logdepthbuf_vertex:_m,map_fragment:ym,map_pars_fragment:vm,map_particle_fragment:bm,map_particle_pars_fragment:Mm,metalnessmap_fragment:Sm,metalnessmap_pars_fragment:wm,morphinstance_vertex:Em,morphcolor_vertex:Tm,morphnormal_vertex:Am,morphtarget_pars_vertex:Rm,morphtarget_vertex:Cm,normal_fragment_begin:Pm,normal_fragment_maps:Im,normal_pars_fragment:Lm,normal_pars_vertex:Fm,normal_vertex:Nm,normalmap_pars_fragment:Dm,clearcoat_normal_fragment_begin:Um,clearcoat_normal_fragment_maps:Om,clearcoat_pars_fragment:Bm,iridescence_pars_fragment:zm,opaque_fragment:km,packing:Vm,premultiplied_alpha_fragment:Hm,project_vertex:Gm,dithering_fragment:Wm,dithering_pars_fragment:Xm,roughnessmap_fragment:qm,roughnessmap_pars_fragment:Ym,shadowmap_pars_fragment:$m,shadowmap_pars_vertex:Zm,shadowmap_vertex:Jm,shadowmask_pars_fragment:Km,skinbase_vertex:jm,skinning_pars_vertex:Qm,skinning_vertex:eg,skinnormal_vertex:tg,specularmap_fragment:ng,specularmap_pars_fragment:ig,tonemapping_fragment:sg,tonemapping_pars_fragment:rg,transmission_fragment:ag,transmission_pars_fragment:og,uv_pars_fragment:lg,uv_pars_vertex:cg,uv_vertex:hg,worldpos_vertex:ug,background_vert:dg,background_frag:fg,backgroundCube_vert:pg,backgroundCube_frag:mg,cube_vert:gg,cube_frag:xg,depth_vert:_g,depth_frag:yg,distance_vert:vg,distance_frag:bg,equirect_vert:Mg,equirect_frag:Sg,linedashed_vert:wg,linedashed_frag:Eg,meshbasic_vert:Tg,meshbasic_frag:Ag,meshlambert_vert:Rg,meshlambert_frag:Cg,meshmatcap_vert:Pg,meshmatcap_frag:Ig,meshnormal_vert:Lg,meshnormal_frag:Fg,meshphong_vert:Ng,meshphong_frag:Dg,meshphysical_vert:Ug,meshphysical_frag:Og,meshtoon_vert:Bg,meshtoon_frag:zg,points_vert:kg,points_frag:Vg,shadow_vert:Hg,shadow_frag:Gg,sprite_vert:Wg,sprite_frag:Xg},Ce={common:{diffuse:{value:new dt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new rt}},envmap:{envMap:{value:null},envMapRotation:{value:new rt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new rt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new rt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new rt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new rt},normalScale:{value:new we(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new rt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new rt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new rt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new rt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new dt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new U},probesMax:{value:new U},probesResolution:{value:new U}},points:{diffuse:{value:new dt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0},uvTransform:{value:new rt}},sprite:{diffuse:{value:new dt(16777215)},opacity:{value:1},center:{value:new we(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}}},Hn={basic:{uniforms:$t([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.fog]),vertexShader:ct.meshbasic_vert,fragmentShader:ct.meshbasic_frag},lambert:{uniforms:$t([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,Ce.lights,{emissive:{value:new dt(0)},envMapIntensity:{value:1}}]),vertexShader:ct.meshlambert_vert,fragmentShader:ct.meshlambert_frag},phong:{uniforms:$t([Ce.common,Ce.specularmap,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,Ce.lights,{emissive:{value:new dt(0)},specular:{value:new dt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:ct.meshphong_vert,fragmentShader:ct.meshphong_frag},standard:{uniforms:$t([Ce.common,Ce.envmap,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.roughnessmap,Ce.metalnessmap,Ce.fog,Ce.lights,{emissive:{value:new dt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ct.meshphysical_vert,fragmentShader:ct.meshphysical_frag},toon:{uniforms:$t([Ce.common,Ce.aomap,Ce.lightmap,Ce.emissivemap,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.gradientmap,Ce.fog,Ce.lights,{emissive:{value:new dt(0)}}]),vertexShader:ct.meshtoon_vert,fragmentShader:ct.meshtoon_frag},matcap:{uniforms:$t([Ce.common,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,Ce.fog,{matcap:{value:null}}]),vertexShader:ct.meshmatcap_vert,fragmentShader:ct.meshmatcap_frag},points:{uniforms:$t([Ce.points,Ce.fog]),vertexShader:ct.points_vert,fragmentShader:ct.points_frag},dashed:{uniforms:$t([Ce.common,Ce.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ct.linedashed_vert,fragmentShader:ct.linedashed_frag},depth:{uniforms:$t([Ce.common,Ce.displacementmap]),vertexShader:ct.depth_vert,fragmentShader:ct.depth_frag},normal:{uniforms:$t([Ce.common,Ce.bumpmap,Ce.normalmap,Ce.displacementmap,{opacity:{value:1}}]),vertexShader:ct.meshnormal_vert,fragmentShader:ct.meshnormal_frag},sprite:{uniforms:$t([Ce.sprite,Ce.fog]),vertexShader:ct.sprite_vert,fragmentShader:ct.sprite_frag},background:{uniforms:{uvTransform:{value:new rt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ct.background_vert,fragmentShader:ct.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new rt}},vertexShader:ct.backgroundCube_vert,fragmentShader:ct.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ct.cube_vert,fragmentShader:ct.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ct.equirect_vert,fragmentShader:ct.equirect_frag},distance:{uniforms:$t([Ce.common,Ce.displacementmap,{referencePosition:{value:new U},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ct.distance_vert,fragmentShader:ct.distance_frag},shadow:{uniforms:$t([Ce.lights,Ce.fog,{color:{value:new dt(0)},opacity:{value:1}}]),vertexShader:ct.shadow_vert,fragmentShader:ct.shadow_frag}};Hn.physical={uniforms:$t([Hn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new rt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new rt},clearcoatNormalScale:{value:new we(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new rt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new rt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new rt},sheen:{value:0},sheenColor:{value:new dt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new rt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new rt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new rt},transmissionSamplerSize:{value:new we},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new rt},attenuationDistance:{value:0},attenuationColor:{value:new dt(0)},specularColor:{value:new dt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new rt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new rt},anisotropyVector:{value:new we},anisotropyMap:{value:null},anisotropyMapTransform:{value:new rt}}]),vertexShader:ct.meshphysical_vert,fragmentShader:ct.meshphysical_frag};var el={r:0,b:0,g:0},qg=new Et,md=new rt;md.set(-1,0,0,0,1,0,0,0,1);function Yg(i,e,t,n,s,r){let a=new dt(0),o=s===!0?0:1,l,c,h=null,u=0,d=null;function f(S){let w=S.isScene===!0?S.background:null;if(w&&w.isTexture){let y=S.backgroundBlurriness>0;w=e.get(w,y)}return w}function x(S){let w=!1,y=f(S);y===null?m(a,o):y&&y.isColor&&(m(y,1),w=!0);let A=i.xr.getEnvironmentBlendMode();A==="additive"?t.buffers.color.setClear(0,0,0,1,r):A==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,r),(i.autoClear||w)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function b(S,w){let y=f(w);y&&(y.isCubeTexture||y.mapping===Cr)?(c===void 0&&(c=new vt(new Yt(1,1,1),new pn({name:"BackgroundCubeMaterial",uniforms:Hi(Hn.backgroundCube.uniforms),vertexShader:Hn.backgroundCube.vertexShader,fragmentShader:Hn.backgroundCube.fragmentShader,side:Zt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,R,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=w.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(qg.makeRotationFromEuler(w.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(md),c.material.toneMapped=mt.getTransfer(y.colorSpace)!==bt,(h!==y||u!==y.version||d!==i.toneMapping)&&(c.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),c.layers.enableAll(),S.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new vt(new yn(2,2),new pn({name:"BackgroundMaterial",uniforms:Hi(Hn.background.uniforms),vertexShader:Hn.background.vertexShader,fragmentShader:Hn.background.fragmentShader,side:Jn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,l.material.toneMapped=mt.getTransfer(y.colorSpace)!==bt,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(h!==y||u!==y.version||d!==i.toneMapping)&&(l.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),l.layers.enableAll(),S.unshift(l,l.geometry,l.material,0,0,null))}function m(S,w){S.getRGB(el,Tc(i)),t.buffers.color.setClear(el.r,el.g,el.b,w,r)}function p(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(S,w=1){a.set(S),o=w,m(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(S){o=S,m(a,o)},render:x,addToRenderList:b,dispose:p}}function $g(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,a=!1;function o(I,k,Y,J,O){let $=!1,V=u(I,J,Y,k);r!==V&&(r=V,c(r.object)),$=f(I,J,Y,O),$&&x(I,J,Y,O),O!==null&&e.update(O,i.ELEMENT_ARRAY_BUFFER),($||a)&&(a=!1,y(I,k,Y,J),O!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(O).buffer))}function l(){return i.createVertexArray()}function c(I){return i.bindVertexArray(I)}function h(I){return i.deleteVertexArray(I)}function u(I,k,Y,J){let O=J.wireframe===!0,$=n[k.id];$===void 0&&($={},n[k.id]=$);let V=I.isInstancedMesh===!0?I.id:0,ie=$[V];ie===void 0&&(ie={},$[V]=ie);let he=ie[Y.id];he===void 0&&(he={},ie[Y.id]=he);let xe=he[O];return xe===void 0&&(xe=d(l()),he[O]=xe),xe}function d(I){let k=[],Y=[],J=[];for(let O=0;O<t;O++)k[O]=0,Y[O]=0,J[O]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:k,enabledAttributes:Y,attributeDivisors:J,object:I,attributes:{},index:null}}function f(I,k,Y,J){let O=r.attributes,$=k.attributes,V=0,ie=Y.getAttributes();for(let he in ie)if(ie[he].location>=0){let ce=O[he],pe=$[he];if(pe===void 0&&(he==="instanceMatrix"&&I.instanceMatrix&&(pe=I.instanceMatrix),he==="instanceColor"&&I.instanceColor&&(pe=I.instanceColor)),ce===void 0||ce.attribute!==pe||pe&&ce.data!==pe.data)return!0;V++}return r.attributesNum!==V||r.index!==J}function x(I,k,Y,J){let O={},$=k.attributes,V=0,ie=Y.getAttributes();for(let he in ie)if(ie[he].location>=0){let ce=$[he];ce===void 0&&(he==="instanceMatrix"&&I.instanceMatrix&&(ce=I.instanceMatrix),he==="instanceColor"&&I.instanceColor&&(ce=I.instanceColor));let pe={};pe.attribute=ce,ce&&ce.data&&(pe.data=ce.data),O[he]=pe,V++}r.attributes=O,r.attributesNum=V,r.index=J}function b(){let I=r.newAttributes;for(let k=0,Y=I.length;k<Y;k++)I[k]=0}function m(I){p(I,0)}function p(I,k){let Y=r.newAttributes,J=r.enabledAttributes,O=r.attributeDivisors;Y[I]=1,J[I]===0&&(i.enableVertexAttribArray(I),J[I]=1),O[I]!==k&&(i.vertexAttribDivisor(I,k),O[I]=k)}function S(){let I=r.newAttributes,k=r.enabledAttributes;for(let Y=0,J=k.length;Y<J;Y++)k[Y]!==I[Y]&&(i.disableVertexAttribArray(Y),k[Y]=0)}function w(I,k,Y,J,O,$,V){V===!0?i.vertexAttribIPointer(I,k,Y,O,$):i.vertexAttribPointer(I,k,Y,J,O,$)}function y(I,k,Y,J){b();let O=J.attributes,$=Y.getAttributes(),V=k.defaultAttributeValues;for(let ie in $){let he=$[ie];if(he.location>=0){let xe=O[ie];if(xe===void 0&&(ie==="instanceMatrix"&&I.instanceMatrix&&(xe=I.instanceMatrix),ie==="instanceColor"&&I.instanceColor&&(xe=I.instanceColor)),xe!==void 0){let ce=xe.normalized,pe=xe.itemSize,nt=e.get(xe);if(nt===void 0)continue;let st=nt.buffer,qe=nt.type,ee=nt.bytesPerElement,ve=qe===i.INT||qe===i.UNSIGNED_INT||xe.gpuType===po;if(xe.isInterleavedBufferAttribute){let le=xe.data,Ne=le.stride,Pe=xe.offset;if(le.isInstancedInterleavedBuffer){for(let Ee=0;Ee<he.locationSize;Ee++)p(he.location+Ee,le.meshPerAttribute);I.isInstancedMesh!==!0&&J._maxInstanceCount===void 0&&(J._maxInstanceCount=le.meshPerAttribute*le.count)}else for(let Ee=0;Ee<he.locationSize;Ee++)m(he.location+Ee);i.bindBuffer(i.ARRAY_BUFFER,st);for(let Ee=0;Ee<he.locationSize;Ee++)w(he.location+Ee,pe/he.locationSize,qe,ce,Ne*ee,(Pe+pe/he.locationSize*Ee)*ee,ve)}else{if(xe.isInstancedBufferAttribute){for(let le=0;le<he.locationSize;le++)p(he.location+le,xe.meshPerAttribute);I.isInstancedMesh!==!0&&J._maxInstanceCount===void 0&&(J._maxInstanceCount=xe.meshPerAttribute*xe.count)}else for(let le=0;le<he.locationSize;le++)m(he.location+le);i.bindBuffer(i.ARRAY_BUFFER,st);for(let le=0;le<he.locationSize;le++)w(he.location+le,pe/he.locationSize,qe,ce,pe*ee,pe/he.locationSize*le*ee,ve)}}else if(V!==void 0){let ce=V[ie];if(ce!==void 0)switch(ce.length){case 2:i.vertexAttrib2fv(he.location,ce);break;case 3:i.vertexAttrib3fv(he.location,ce);break;case 4:i.vertexAttrib4fv(he.location,ce);break;default:i.vertexAttrib1fv(he.location,ce)}}}}S()}function A(){E();for(let I in n){let k=n[I];for(let Y in k){let J=k[Y];for(let O in J){let $=J[O];for(let V in $)h($[V].object),delete $[V];delete J[O]}}delete n[I]}}function R(I){if(n[I.id]===void 0)return;let k=n[I.id];for(let Y in k){let J=k[Y];for(let O in J){let $=J[O];for(let V in $)h($[V].object),delete $[V];delete J[O]}}delete n[I.id]}function C(I){for(let k in n){let Y=n[k];for(let J in Y){let O=Y[J];if(O[I.id]===void 0)continue;let $=O[I.id];for(let V in $)h($[V].object),delete $[V];delete O[I.id]}}}function _(I){for(let k in n){let Y=n[k],J=I.isInstancedMesh===!0?I.id:0,O=Y[J];if(O!==void 0){for(let $ in O){let V=O[$];for(let ie in V)h(V[ie].object),delete V[ie];delete O[$]}delete Y[J],Object.keys(Y).length===0&&delete n[k]}}}function E(){P(),a=!0,r!==s&&(r=s,c(r.object))}function P(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:E,resetDefaultState:P,dispose:A,releaseStatesOfGeometry:R,releaseStatesOfObject:_,releaseStatesOfProgram:C,initAttributes:b,enableAttribute:m,disableUnusedAttributes:S}}function Zg(i,e,t){let n;function s(l){n=l}function r(l,c){i.drawArrays(n,l,c),t.update(c,n,1)}function a(l,c,h){h!==0&&(i.drawArraysInstanced(n,l,c,h),t.update(c,n,h))}function o(l,c,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,h);let d=0;for(let f=0;f<h;f++)d+=c[f];t.update(d,n,1)}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o}function Jg(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(C){return!(C!==bn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(C){let _=C===kn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==an&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==vn&&!_)}function l(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",h=l(c);h!==c&&(tt("WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let u=t.logarithmicDepthBuffer===!0,d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control");t.reversedDepthBuffer===!0&&d===!1&&tt("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),b=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),S=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),w=i.getParameter(i.MAX_VARYING_VECTORS),y=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),A=i.getParameter(i.MAX_SAMPLES),R=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:u,reversedDepthBuffer:d,maxTextures:f,maxVertexTextures:x,maxTextureSize:b,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:S,maxVaryings:w,maxFragmentUniforms:y,maxSamples:A,samples:R}}function Kg(i){let e=this,t=null,n=0,s=!1,r=!1,a=new Ln,o=new rt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||s;return s=d,n=u.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let x=u.clippingPlanes,b=u.clipIntersection,m=u.clipShadows,p=i.get(u);if(!s||x===null||x.length===0||r&&!m)r?h(null):c();else{let S=r?0:n,w=S*4,y=p.clippingState||null;l.value=y,y=h(x,d,w,f);for(let A=0;A!==w;++A)y[A]=t[A];p.clippingState=y,this.numIntersection=b?this.numPlanes:0,this.numPlanes+=S}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,x){let b=u!==null?u.length:0,m=null;if(b!==0){if(m=l.value,x!==!0||m===null){let p=f+b*4,S=d.matrixWorldInverse;o.getNormalMatrix(S),(m===null||m.length<p)&&(m=new Float32Array(p));for(let w=0,y=f;w!==b;++w,y+=4)a.copy(u[w]).applyMatrix4(S,o),a.normal.toArray(m,y),m[y+3]=a.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=b,e.numIntersection=0,m}}var Si=4,qu=[.125,.215,.35,.446,.526,.582],Gi=20,jg=256,Or=new ws,Yu=new dt,Pc=null,Ic=0,Lc=0,Fc=!1,Qg=new U,nl=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,s=100,r={}){let{size:a=256,position:o=Qg}=r;Pc=this._renderer.getRenderTarget(),Ic=this._renderer.getActiveCubeFace(),Lc=this._renderer.getActiveMipmapLevel(),Fc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,n,s,l,o),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Ju(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Zu(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Pc,Ic,Lc),this._renderer.xr.enabled=Fc,e.scissorTest=!1,Cs(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===yi||e.mapping===Vi?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Pc=this._renderer.getRenderTarget(),Ic=this._renderer.getActiveCubeFace(),Lc=this._renderer.getActiveMipmapLevel(),Fc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Ht,minFilter:Ht,generateMipmaps:!1,type:kn,format:bn,colorSpace:Qs,depthBuffer:!1},s=$u(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=$u(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=e0(r)),this._blurMaterial=n0(r,e,t),this._ggxMaterial=t0(r,e,t)}return s}_compileMaterial(e){let t=new vt(new Nt,e);this._renderer.compile(t,Or)}_sceneToCubeUV(e,t,n,s,r){let l=new Vt(90,1,t,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,f=u.toneMapping;u.getClearColor(Yu),u.toneMapping=An,u.autoClear=!1,u.state.buffers.depth.getReversed()&&(u.setRenderTarget(s),u.clearDepth(),u.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new vt(new Yt,new Bn({name:"PMREM.Background",side:Zt,depthWrite:!1,depthTest:!1})));let b=this._backgroundBox,m=b.material,p=!1,S=e.background;S?S.isColor&&(m.color.copy(S),e.background=null,p=!0):(m.color.copy(Yu),p=!0);for(let w=0;w<6;w++){let y=w%3;y===0?(l.up.set(0,c[w],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+h[w],r.y,r.z)):y===1?(l.up.set(0,0,c[w]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+h[w],r.z)):(l.up.set(0,c[w],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+h[w]));let A=this._cubeSize;Cs(s,y*A,w>2?A:0,A,A),u.setRenderTarget(s),p&&u.render(b,l),u.render(e,l)}u.toneMapping=f,u.autoClear=d,e.background=S}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===yi||e.mapping===Vi;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Ju()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Zu());let r=s?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=r;let o=r.uniforms;o.envMap.value=e;let l=this._cubeSize;Cs(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,Or)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let s=this._lodMeshes.length;for(let r=1;r<s;r++)this._applyGGXFilter(e,r-1,r);t.autoClear=n}_applyGGXFilter(e,t,n){let s=this._renderer,r=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let l=a.uniforms,c=n/(this._lodMeshes.length-1),h=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-h*h),d=0+c*1.25,f=u*d,{_lodMax:x}=this,b=this._sizeLods[n],m=3*b*(n>x-Si?n-x+Si:0),p=4*(this._cubeSize-b);l.envMap.value=e.texture,l.roughness.value=f,l.mipInt.value=x-t,Cs(r,m,p,3*b,2*b),s.setRenderTarget(r),s.render(o,Or),l.envMap.value=r.texture,l.roughness.value=0,l.mipInt.value=x-n,Cs(e,m,p,3*b,2*b),s.setRenderTarget(e),s.render(o,Or)}_blur(e,t,n,s,r){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,s,"latitudinal",r),this._halfBlur(a,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,a,o){let l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&it("blur direction must be either latitudinal or longitudinal!");let h=3,u=this._lodMeshes[s];u.material=c;let d=c.uniforms,f=this._sizeLods[n]-1,x=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*Gi-1),b=r/x,m=isFinite(r)?1+Math.floor(h*b):Gi;m>Gi&&tt(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Gi}`);let p=[],S=0;for(let C=0;C<Gi;++C){let _=C/b,E=Math.exp(-_*_/2);p.push(E),C===0?S+=E:C<m&&(S+=2*E)}for(let C=0;C<p.length;C++)p[C]=p[C]/S;d.envMap.value=e.texture,d.samples.value=m,d.weights.value=p,d.latitudinal.value=a==="latitudinal",o&&(d.poleAxis.value=o);let{_lodMax:w}=this;d.dTheta.value=x,d.mipInt.value=w-n;let y=this._sizeLods[s],A=3*y*(s>w-Si?s-w+Si:0),R=4*(this._cubeSize-y);Cs(t,A,R,3*y,2*y),l.setRenderTarget(t),l.render(u,Or)}};function e0(i){let e=[],t=[],n=[],s=i,r=i-Si+1+qu.length;for(let a=0;a<r;a++){let o=Math.pow(2,s);e.push(o);let l=1/o;a>i-Si?l=qu[a-i+Si-1]:a===0&&(l=0),t.push(l);let c=1/(o-2),h=-c,u=1+c,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,x=6,b=3,m=2,p=1,S=new Float32Array(b*x*f),w=new Float32Array(m*x*f),y=new Float32Array(p*x*f);for(let R=0;R<f;R++){let C=R%3*2/3-1,_=R>2?0:-1,E=[C,_,0,C+2/3,_,0,C+2/3,_+1,0,C,_,0,C+2/3,_+1,0,C,_+1,0];S.set(E,b*x*R),w.set(d,m*x*R);let P=[R,R,R,R,R,R];y.set(P,p*x*R)}let A=new Nt;A.setAttribute("position",new tn(S,b)),A.setAttribute("uv",new tn(w,m)),A.setAttribute("faceIndex",new tn(y,p)),n.push(new vt(A,null)),s>Si&&s--}return{lodMeshes:n,sizeLods:e,sigmas:t}}function $u(i,e,t){let n=new dn(i,e,t);return n.texture.mapping=Cr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Cs(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function t0(i,e,t){return new pn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:jg,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:rl(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:zn,depthTest:!1,depthWrite:!1})}function n0(i,e,t){let n=new Float32Array(Gi),s=new U(0,1,0);return new pn({name:"SphericalGaussianBlur",defines:{n:Gi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:rl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:zn,depthTest:!1,depthWrite:!1})}function Zu(){return new pn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:rl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:zn,depthTest:!1,depthWrite:!1})}function Ju(){return new pn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:rl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:zn,depthTest:!1,depthWrite:!1})}function rl(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}var il=class extends dn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new cr(s),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new Yt(5,5,5),r=new pn({name:"CubemapFromEquirect",uniforms:Hi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Zt,blending:zn});r.uniforms.tEquirect.value=t;let a=new vt(s,r),o=t.minFilter;return t.minFilter===vi&&(t.minFilter=Ht),new oo(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}};function i0(i){let e=new WeakMap,t=new WeakMap,n=null;function s(d,f=!1){return d==null?null:f?a(d):r(d)}function r(d){if(d&&d.isTexture){let f=d.mapping;if(f===ho||f===uo)if(e.has(d)){let x=e.get(d).texture;return o(x,d.mapping)}else{let x=d.image;if(x&&x.height>0){let b=new il(x.height);return b.fromEquirectangularTexture(i,d),e.set(d,b),d.addEventListener("dispose",c),o(b.texture,d.mapping)}else return null}}return d}function a(d){if(d&&d.isTexture){let f=d.mapping,x=f===ho||f===uo,b=f===yi||f===Vi;if(x||b){let m=t.get(d),p=m!==void 0?m.texture.pmremVersion:0;if(d.isRenderTargetTexture&&d.pmremVersion!==p)return n===null&&(n=new nl(i)),m=x?n.fromEquirectangular(d,m):n.fromCubemap(d,m),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),m.texture;if(m!==void 0)return m.texture;{let S=d.image;return x&&S&&S.height>0||b&&S&&l(S)?(n===null&&(n=new nl(i)),m=x?n.fromEquirectangular(d):n.fromCubemap(d),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),d.addEventListener("dispose",h),m.texture):null}}}return d}function o(d,f){return f===ho?d.mapping=yi:f===uo&&(d.mapping=Vi),d}function l(d){let f=0,x=6;for(let b=0;b<x;b++)d[b]!==void 0&&f++;return f===x}function c(d){let f=d.target;f.removeEventListener("dispose",c);let x=e.get(f);x!==void 0&&(e.delete(f),x.dispose())}function h(d){let f=d.target;f.removeEventListener("dispose",h);let x=t.get(f);x!==void 0&&(t.delete(f),x.dispose())}function u(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:s,dispose:u}}function s0(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s=i.getExtension(n);return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&Ni("WebGLRenderer: "+n+" extension not supported."),s}}}function r0(i,e,t,n){let s={},r=new WeakMap;function a(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let x in d.attributes)e.remove(d.attributes[x]);d.removeEventListener("dispose",a),delete s[d.id];let f=r.get(d);f&&(e.remove(f),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return s[d.id]===!0||(d.addEventListener("dispose",a),s[d.id]=!0,t.memory.geometries++),d}function l(u){let d=u.attributes;for(let f in d)e.update(d[f],i.ARRAY_BUFFER)}function c(u){let d=[],f=u.index,x=u.attributes.position,b=0;if(x===void 0)return;if(f!==null){let S=f.array;b=f.version;for(let w=0,y=S.length;w<y;w+=3){let A=S[w+0],R=S[w+1],C=S[w+2];d.push(A,R,R,C,C,A)}}else{let S=x.array;b=x.version;for(let w=0,y=S.length/3-1;w<y;w+=3){let A=w+0,R=w+1,C=w+2;d.push(A,R,R,C,C,A)}}let m=new(x.count>=65535?ar:rr)(d,1);m.version=b;let p=r.get(u);p&&e.remove(p),r.set(u,m)}function h(u){let d=r.get(u);if(d){let f=u.index;f!==null&&d.version<f.version&&c(u)}else c(u);return r.get(u)}return{get:o,update:l,getWireframeAttribute:h}}function a0(i,e,t){let n;function s(u){n=u}let r,a;function o(u){r=u.type,a=u.bytesPerElement}function l(u,d){i.drawElements(n,d,r,u*a),t.update(d,n,1)}function c(u,d,f){f!==0&&(i.drawElementsInstanced(n,d,r,u*a,f),t.update(d,n,f))}function h(u,d,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,d,0,r,u,0,f);let b=0;for(let m=0;m<f;m++)b+=d[m];t.update(b,n,1)}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h}function o0(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:it("WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function l0(i,e,t){let n=new WeakMap,s=new Rt;function r(a,o,l){let c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(o);if(d===void 0||d.count!==u){let E=function(){C.dispose(),n.delete(o),o.removeEventListener("dispose",E)};d!==void 0&&d.texture.dispose();let f=o.morphAttributes.position!==void 0,x=o.morphAttributes.normal!==void 0,b=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],p=o.morphAttributes.normal||[],S=o.morphAttributes.color||[],w=0;f===!0&&(w=1),x===!0&&(w=2),b===!0&&(w=3);let y=o.attributes.position.count*w,A=1;y>e.maxTextureSize&&(A=Math.ceil(y/e.maxTextureSize),y=e.maxTextureSize);let R=new Float32Array(y*A*4*u),C=new nr(R,y,A,u);C.type=vn,C.needsUpdate=!0;let _=w*4;for(let P=0;P<u;P++){let I=m[P],k=p[P],Y=S[P],J=y*A*4*P;for(let O=0;O<I.count;O++){let $=O*_;f===!0&&(s.fromBufferAttribute(I,O),R[J+$+0]=s.x,R[J+$+1]=s.y,R[J+$+2]=s.z,R[J+$+3]=0),x===!0&&(s.fromBufferAttribute(k,O),R[J+$+4]=s.x,R[J+$+5]=s.y,R[J+$+6]=s.z,R[J+$+7]=0),b===!0&&(s.fromBufferAttribute(Y,O),R[J+$+8]=s.x,R[J+$+9]=s.y,R[J+$+10]=s.z,R[J+$+11]=Y.itemSize===4?s.w:1)}}d={count:u,texture:C,size:new we(y,A)},n.set(o,d),o.addEventListener("dispose",E)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let f=0;for(let b=0;b<c.length;b++)f+=c[b];let x=o.morphTargetsRelative?1:1-f;l.getUniforms().setValue(i,"morphTargetBaseInfluence",x),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function c0(i,e,t,n,s){let r=new WeakMap;function a(c){let h=s.render.frame,u=c.geometry,d=e.get(c,u);if(r.get(d)!==h&&(e.update(d),r.set(d,h)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),r.get(c)!==h&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),r.set(c,h))),c.isSkinnedMesh){let f=c.skeleton;r.get(f)!==h&&(f.update(),r.set(f,h))}return d}function o(){r=new WeakMap}function l(c){let h=c.target;h.removeEventListener("dispose",l),n.releaseStatesOfObject(h),t.remove(h.instanceMatrix),h.instanceColor!==null&&t.remove(h.instanceColor)}return{update:a,dispose:o}}var h0={[cc]:"LINEAR_TONE_MAPPING",[hc]:"REINHARD_TONE_MAPPING",[uc]:"CINEON_TONE_MAPPING",[dc]:"ACES_FILMIC_TONE_MAPPING",[pc]:"AGX_TONE_MAPPING",[mc]:"NEUTRAL_TONE_MAPPING",[fc]:"CUSTOM_TONE_MAPPING"};function u0(i,e,t,n,s,r){let a=new dn(e,t,{type:i,depthBuffer:s,stencilBuffer:r,samples:n?4:0,depthTexture:s?new Qn(e,t):void 0}),o=new dn(e,t,{type:kn,depthBuffer:!1,stencilBuffer:!1}),l=new Nt;l.setAttribute("position",new ut([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute("uv",new ut([0,2,0,0,2,0],2));let c=new $a({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),h=new vt(l,c),u=new ws(-1,1,1,-1,0,1),d=null,f=null,x=!1,b,m=null,p=[],S=!1;this.setSize=function(w,y){a.setSize(w,y),o.setSize(w,y);for(let A=0;A<p.length;A++){let R=p[A];R.setSize&&R.setSize(w,y)}},this.setEffects=function(w){p=w,S=p.length>0&&p[0].isRenderPass===!0;let y=a.width,A=a.height;for(let R=0;R<p.length;R++){let C=p[R];C.setSize&&C.setSize(y,A)}},this.begin=function(w,y){if(x||w.toneMapping===An&&p.length===0)return!1;if(m=y,y!==null){let A=y.width,R=y.height;(a.width!==A||a.height!==R)&&this.setSize(A,R)}return S===!1&&w.setRenderTarget(a),b=w.toneMapping,w.toneMapping=An,!0},this.hasRenderPass=function(){return S},this.end=function(w,y){w.toneMapping=b,x=!0;let A=a,R=o;for(let C=0;C<p.length;C++){let _=p[C];if(_.enabled!==!1&&(_.render(w,R,A,y),_.needsSwap!==!1)){let E=A;A=R,R=E}}if(d!==w.outputColorSpace||f!==w.toneMapping){d=w.outputColorSpace,f=w.toneMapping,c.defines={},mt.getTransfer(d)===bt&&(c.defines.SRGB_TRANSFER="");let C=h0[f];C&&(c.defines[C]=""),c.needsUpdate=!0}c.uniforms.tDiffuse.value=A.texture,w.setRenderTarget(m),w.render(h,u),m=null,x=!1},this.isCompositing=function(){return x},this.dispose=function(){a.depthTexture&&a.depthTexture.dispose(),a.dispose(),o.dispose(),l.dispose(),c.dispose()}}var gd=new nn,Uc=new Qn(1,1),xd=new nr,_d=new Ba,yd=new cr,Ku=[],ju=[],Qu=new Float32Array(16),ed=new Float32Array(9),td=new Float32Array(4);function Is(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Ku[s];if(r===void 0&&(r=new Float32Array(s),Ku[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function Ot(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Bt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function al(i,e){let t=ju[e];t===void 0&&(t=new Int32Array(e),ju[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function d0(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function f0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2fv(this.addr,e),Bt(t,e)}}function p0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(Ot(t,e))return;i.uniform3fv(this.addr,e),Bt(t,e)}}function m0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4fv(this.addr,e),Bt(t,e)}}function g0(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;td.set(n),i.uniformMatrix2fv(this.addr,!1,td),Bt(t,n)}}function x0(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;ed.set(n),i.uniformMatrix3fv(this.addr,!1,ed),Bt(t,n)}}function _0(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;Qu.set(n),i.uniformMatrix4fv(this.addr,!1,Qu),Bt(t,n)}}function y0(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function v0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2iv(this.addr,e),Bt(t,e)}}function b0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Ot(t,e))return;i.uniform3iv(this.addr,e),Bt(t,e)}}function M0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4iv(this.addr,e),Bt(t,e)}}function S0(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function w0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2uiv(this.addr,e),Bt(t,e)}}function E0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Ot(t,e))return;i.uniform3uiv(this.addr,e),Bt(t,e)}}function T0(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4uiv(this.addr,e),Bt(t,e)}}function A0(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Uc.compareFunction=t.isReversedDepthBuffer()?Qo:jo,r=Uc):r=gd,t.setTexture2D(e||r,s)}function R0(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||_d,s)}function C0(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||yd,s)}function P0(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||xd,s)}function I0(i){switch(i){case 5126:return d0;case 35664:return f0;case 35665:return p0;case 35666:return m0;case 35674:return g0;case 35675:return x0;case 35676:return _0;case 5124:case 35670:return y0;case 35667:case 35671:return v0;case 35668:case 35672:return b0;case 35669:case 35673:return M0;case 5125:return S0;case 36294:return w0;case 36295:return E0;case 36296:return T0;case 35678:case 36198:case 36298:case 36306:case 35682:return A0;case 35679:case 36299:case 36307:return R0;case 35680:case 36300:case 36308:case 36293:return C0;case 36289:case 36303:case 36311:case 36292:return P0}}function L0(i,e){i.uniform1fv(this.addr,e)}function F0(i,e){let t=Is(e,this.size,2);i.uniform2fv(this.addr,t)}function N0(i,e){let t=Is(e,this.size,3);i.uniform3fv(this.addr,t)}function D0(i,e){let t=Is(e,this.size,4);i.uniform4fv(this.addr,t)}function U0(i,e){let t=Is(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function O0(i,e){let t=Is(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function B0(i,e){let t=Is(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function z0(i,e){i.uniform1iv(this.addr,e)}function k0(i,e){i.uniform2iv(this.addr,e)}function V0(i,e){i.uniform3iv(this.addr,e)}function H0(i,e){i.uniform4iv(this.addr,e)}function G0(i,e){i.uniform1uiv(this.addr,e)}function W0(i,e){i.uniform2uiv(this.addr,e)}function X0(i,e){i.uniform3uiv(this.addr,e)}function q0(i,e){i.uniform4uiv(this.addr,e)}function Y0(i,e,t){let n=this.cache,s=e.length,r=al(t,s);Ot(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));let a;this.type===i.SAMPLER_2D_SHADOW?a=Uc:a=gd;for(let o=0;o!==s;++o)t.setTexture2D(e[o]||a,r[o])}function $0(i,e,t){let n=this.cache,s=e.length,r=al(t,s);Ot(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||_d,r[a])}function Z0(i,e,t){let n=this.cache,s=e.length,r=al(t,s);Ot(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));for(let a=0;a!==s;++a)t.setTextureCube(e[a]||yd,r[a])}function J0(i,e,t){let n=this.cache,s=e.length,r=al(t,s);Ot(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||xd,r[a])}function K0(i){switch(i){case 5126:return L0;case 35664:return F0;case 35665:return N0;case 35666:return D0;case 35674:return U0;case 35675:return O0;case 35676:return B0;case 5124:case 35670:return z0;case 35667:case 35671:return k0;case 35668:case 35672:return V0;case 35669:case 35673:return H0;case 5125:return G0;case 36294:return W0;case 36295:return X0;case 36296:return q0;case 35678:case 36198:case 36298:case 36306:case 35682:return Y0;case 35679:case 36299:case 36307:return $0;case 35680:case 36300:case 36308:case 36293:return Z0;case 36289:case 36303:case 36311:case 36292:return J0}}var Oc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=I0(t.type)}},Bc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=K0(t.type)}},zc=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,t[o.id],n)}}},Nc=/(\w+)(\])?(\[|\.)?/g;function nd(i,e){i.seq.push(e),i.map[e.id]=e}function j0(i,e,t){let n=i.name,s=n.length;for(Nc.lastIndex=0;;){let r=Nc.exec(n),a=Nc.lastIndex,o=r[1],l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){nd(t,c===void 0?new Oc(o,i,e):new Bc(o,i,e));break}else{let u=t.map[o];u===void 0&&(u=new zc(o),nd(t,u)),t=u}}}var Ps=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=e.getActiveUniform(t,a),l=e.getUniformLocation(t,o.name);j0(o,l,this)}let s=[],r=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?s.push(a):r.push(a);s.length>0&&(this.seq=s.concat(r))}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){let o=t[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in t&&n.push(a)}return n}};function id(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var Q0=37297,ex=0;function tx(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}var sd=new rt;function nx(i){mt._getMatrix(sd,mt.workingColorSpace,i);let e=`mat3( ${sd.elements.map(t=>t.toFixed(4))} )`;switch(mt.getTransfer(i)){case er:return[e,"LinearTransferOETF"];case bt:return[e,"sRGBTransferOETF"];default:return tt("WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function rd(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),r=(i.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let o=parseInt(a[1]);return t.toUpperCase()+`

`+r+`

`+tx(i.getShaderSource(e),o)}else return r}function ix(i,e){let t=nx(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}var sx={[cc]:"Linear",[hc]:"Reinhard",[uc]:"Cineon",[dc]:"ACESFilmic",[pc]:"AgX",[mc]:"Neutral",[fc]:"Custom"};function rx(i,e){let t=sx[e];return t===void 0?(tt("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var tl=new U;function ax(){mt.getLuminanceCoefficients(tl);let i=tl.x.toFixed(4),e=tl.y.toFixed(4),t=tl.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function ox(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(zr).join(`
`)}function lx(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function cx(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),a=r.name,o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function zr(i){return i!==""}function ad(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function od(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var hx=/^[ \t]*#include +<([\w\d./]+)>/gm;function kc(i){return i.replace(hx,dx)}var ux=new Map;function dx(i,e){let t=ct[e];if(t===void 0){let n=ux.get(e);if(n!==void 0)t=ct[n],tt('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+e+">")}return kc(t)}var fx=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function ld(i){return i.replace(fx,px)}function px(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function cd(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}var mx={[ki]:"SHADOWMAP_TYPE_PCF",[Es]:"SHADOWMAP_TYPE_VSM"};function gx(i){return mx[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var xx={[yi]:"ENVMAP_TYPE_CUBE",[Vi]:"ENVMAP_TYPE_CUBE",[Cr]:"ENVMAP_TYPE_CUBE_UV"};function _x(i){return i.envMap===!1?"ENVMAP_TYPE_CUBE":xx[i.envMapMode]||"ENVMAP_TYPE_CUBE"}var yx={[Vi]:"ENVMAP_MODE_REFRACTION"};function vx(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":yx[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}var bx={[co]:"ENVMAP_BLENDING_MULTIPLY",[wu]:"ENVMAP_BLENDING_MIX",[Eu]:"ENVMAP_BLENDING_ADD"};function Mx(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":bx[i.combine]||"ENVMAP_BLENDING_NONE"}function Sx(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function wx(i,e,t,n){let s=i.getContext(),r=t.defines,a=t.vertexShader,o=t.fragmentShader,l=gx(t),c=_x(t),h=vx(t),u=Mx(t),d=Sx(t),f=ox(t),x=lx(r),b=s.createProgram(),m,p,S=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,x].filter(zr).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,x].filter(zr).join(`
`),p.length>0&&(p+=`
`)):(m=[cd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,x,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(zr).join(`
`),p=[cd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,x,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==An?"#define TONE_MAPPING":"",t.toneMapping!==An?ct.tonemapping_pars_fragment:"",t.toneMapping!==An?rx("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",ct.colorspace_pars_fragment,ix("linearToOutputTexel",t.outputColorSpace),ax(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(zr).join(`
`)),a=kc(a),a=ad(a,t),a=od(a,t),o=kc(o),o=ad(o,t),o=od(o,t),a=ld(a),o=ld(o),t.isRawShaderMaterial!==!0&&(S=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",t.glslVersion===Sc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Sc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let w=S+m+a,y=S+p+o,A=id(s,s.VERTEX_SHADER,w),R=id(s,s.FRAGMENT_SHADER,y);s.attachShader(b,A),s.attachShader(b,R),t.index0AttributeName!==void 0?s.bindAttribLocation(b,0,t.index0AttributeName):t.hasPositionAttribute===!0&&s.bindAttribLocation(b,0,"position"),s.linkProgram(b);function C(I){if(i.debug.checkShaderErrors){let k=s.getProgramInfoLog(b)||"",Y=s.getShaderInfoLog(A)||"",J=s.getShaderInfoLog(R)||"",O=k.trim(),$=Y.trim(),V=J.trim(),ie=!0,he=!0;if(s.getProgramParameter(b,s.LINK_STATUS)===!1)if(ie=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,b,A,R);else{let xe=rd(s,A,"vertex"),ce=rd(s,R,"fragment");it("WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(b,s.VALIDATE_STATUS)+`

Material Name: `+I.name+`
Material Type: `+I.type+`

Program Info Log: `+O+`
`+xe+`
`+ce)}else O!==""?tt("WebGLProgram: Program Info Log:",O):($===""||V==="")&&(he=!1);he&&(I.diagnostics={runnable:ie,programLog:O,vertexShader:{log:$,prefix:m},fragmentShader:{log:V,prefix:p}})}s.deleteShader(A),s.deleteShader(R),_=new Ps(s,b),E=cx(s,b)}let _;this.getUniforms=function(){return _===void 0&&C(this),_};let E;this.getAttributes=function(){return E===void 0&&C(this),E};let P=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return P===!1&&(P=s.getProgramParameter(b,Q0)),P},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(b),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=ex++,this.cacheKey=e,this.usedTimes=1,this.program=b,this.vertexShader=A,this.fragmentShader=R,this}var Ex=0,Vc=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let s=this._getShaderCacheForMaterial(e);return s.has(t)===!1&&(s.add(t),t.usedTimes++),s.has(n)===!1&&(s.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Hc(e),t.set(e,n)),n}},Hc=class{constructor(e){this.id=Ex++,this.code=e,this.usedTimes=0}};function Tx(i){return i===Mi||i===Dr||i===Ur}function Ax(i,e,t,n,s,r){let a=new ir,o=new Vc,l=new Set,c=[],h=new Map,u=n.logarithmicDepthBuffer,d=n.precision,f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(_){return l.add(_),_===0?"uv":`uv${_}`}function b(_,E,P,I,k,Y){let J=I.fog,O=k.geometry,$=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?I.environment:null,V=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,ie=e.get(_.envMap||$,V),he=ie&&ie.mapping===Cr?ie.image.height:null,xe=f[_.type];_.precision!==null&&(d=n.getMaxPrecision(_.precision),d!==_.precision&&tt("WebGLProgram.getParameters:",_.precision,"not supported, using",d,"instead."));let ce=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,pe=ce!==void 0?ce.length:0,nt=0;O.morphAttributes.position!==void 0&&(nt=1),O.morphAttributes.normal!==void 0&&(nt=2),O.morphAttributes.color!==void 0&&(nt=3);let st,qe,ee,ve;if(xe){let Be=Hn[xe];st=Be.vertexShader,qe=Be.fragmentShader}else{st=_.vertexShader,qe=_.fragmentShader;let Be=o.getVertexShaderStage(_),_t=o.getFragmentShaderStage(_);o.update(_,Be,_t),ee=Be.id,ve=_t.id}let le=i.getRenderTarget(),Ne=i.state.buffers.depth.getReversed(),Pe=k.isInstancedMesh===!0,Ee=k.isBatchedMesh===!0,Ye=!!_.map,Ue=!!_.matcap,H=!!ie,K=!!_.aoMap,te=!!_.lightMap,ge=!!_.bumpMap&&_.wireframe===!1,de=!!_.normalMap,We=!!_.displacementMap,He=!!_.emissiveMap,je=!!_.metalnessMap,L=!!_.roughnessMap,T=_.anisotropy>0,j=_.clearcoat>0,ue=_.dispersion>0,M=_.iridescence>0,g=_.sheen>0,F=_.transmission>0,z=T&&!!_.anisotropyMap,G=j&&!!_.clearcoatMap,re=j&&!!_.clearcoatNormalMap,fe=j&&!!_.clearcoatRoughnessMap,Q=M&&!!_.iridescenceMap,ne=M&&!!_.iridescenceThicknessMap,be=g&&!!_.sheenColorMap,ke=g&&!!_.sheenRoughnessMap,Ae=!!_.specularMap,Me=!!_.specularColorMap,Ge=!!_.specularIntensityMap,Je=F&&!!_.transmissionMap,Ke=F&&!!_.thicknessMap,D=!!_.gradientMap,_e=!!_.alphaMap,se=_.alphaTest>0,Te=!!_.alphaHash,Ie=!!_.extensions,oe=An;_.toneMapped&&(le===null||le.isXRRenderTarget===!0)&&(oe=i.toneMapping);let Ve={shaderID:xe,shaderType:_.type,shaderName:_.name,vertexShader:st,fragmentShader:qe,defines:_.defines,customVertexShaderID:ee,customFragmentShaderID:ve,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:d,batching:Ee,batchingColor:Ee&&k._colorsTexture!==null,instancing:Pe,instancingColor:Pe&&k.instanceColor!==null,instancingMorph:Pe&&k.morphTexture!==null,outputColorSpace:le===null?i.outputColorSpace:le.isXRRenderTarget===!0?le.texture.colorSpace:mt.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:Ye,matcap:Ue,envMap:H,envMapMode:H&&ie.mapping,envMapCubeUVHeight:he,aoMap:K,lightMap:te,bumpMap:ge,normalMap:de,displacementMap:We,emissiveMap:He,normalMapObjectSpace:de&&_.normalMapType===Ru,normalMapTangentSpace:de&&_.normalMapType===Ko,packedNormalMap:de&&_.normalMapType===Ko&&Tx(_.normalMap.format),metalnessMap:je,roughnessMap:L,anisotropy:T,anisotropyMap:z,clearcoat:j,clearcoatMap:G,clearcoatNormalMap:re,clearcoatRoughnessMap:fe,dispersion:ue,iridescence:M,iridescenceMap:Q,iridescenceThicknessMap:ne,sheen:g,sheenColorMap:be,sheenRoughnessMap:ke,specularMap:Ae,specularColorMap:Me,specularIntensityMap:Ge,transmission:F,transmissionMap:Je,thicknessMap:Ke,gradientMap:D,opaque:_.transparent===!1&&_.blending===Di&&_.alphaToCoverage===!1,alphaMap:_e,alphaTest:se,alphaHash:Te,combine:_.combine,mapUv:Ye&&x(_.map.channel),aoMapUv:K&&x(_.aoMap.channel),lightMapUv:te&&x(_.lightMap.channel),bumpMapUv:ge&&x(_.bumpMap.channel),normalMapUv:de&&x(_.normalMap.channel),displacementMapUv:We&&x(_.displacementMap.channel),emissiveMapUv:He&&x(_.emissiveMap.channel),metalnessMapUv:je&&x(_.metalnessMap.channel),roughnessMapUv:L&&x(_.roughnessMap.channel),anisotropyMapUv:z&&x(_.anisotropyMap.channel),clearcoatMapUv:G&&x(_.clearcoatMap.channel),clearcoatNormalMapUv:re&&x(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:fe&&x(_.clearcoatRoughnessMap.channel),iridescenceMapUv:Q&&x(_.iridescenceMap.channel),iridescenceThicknessMapUv:ne&&x(_.iridescenceThicknessMap.channel),sheenColorMapUv:be&&x(_.sheenColorMap.channel),sheenRoughnessMapUv:ke&&x(_.sheenRoughnessMap.channel),specularMapUv:Ae&&x(_.specularMap.channel),specularColorMapUv:Me&&x(_.specularColorMap.channel),specularIntensityMapUv:Ge&&x(_.specularIntensityMap.channel),transmissionMapUv:Je&&x(_.transmissionMap.channel),thicknessMapUv:Ke&&x(_.thicknessMap.channel),alphaMapUv:_e&&x(_.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(de||T),vertexNormals:!!O.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,pointsUvs:k.isPoints===!0&&!!O.attributes.uv&&(Ye||_e),fog:!!J,useFog:_.fog===!0,fogExp2:!!J&&J.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||O.attributes.normal===void 0&&de===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:u,reversedDepthBuffer:Ne,skinning:k.isSkinnedMesh===!0,hasPositionAttribute:O.attributes.position!==void 0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:pe,morphTextureStride:nt,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numLightProbeGrids:Y.length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:_.dithering,shadowMapEnabled:i.shadowMap.enabled&&P.length>0,shadowMapType:i.shadowMap.type,toneMapping:oe,decodeVideoTexture:Ye&&_.map.isVideoTexture===!0&&mt.getTransfer(_.map.colorSpace)===bt,decodeVideoTextureEmissive:He&&_.emissiveMap.isVideoTexture===!0&&mt.getTransfer(_.emissiveMap.colorSpace)===bt,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===rn,flipSided:_.side===Zt,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:Ie&&_.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ie&&_.extensions.multiDraw===!0||Ee)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return Ve.vertexUv1s=l.has(1),Ve.vertexUv2s=l.has(2),Ve.vertexUv3s=l.has(3),l.clear(),Ve}function m(_){let E=[];if(_.shaderID?E.push(_.shaderID):(E.push(_.customVertexShaderID),E.push(_.customFragmentShaderID)),_.defines!==void 0)for(let P in _.defines)E.push(P),E.push(_.defines[P]);return _.isRawShaderMaterial===!1&&(p(E,_),S(E,_),E.push(i.outputColorSpace)),E.push(_.customProgramCacheKey),E.join()}function p(_,E){_.push(E.precision),_.push(E.outputColorSpace),_.push(E.envMapMode),_.push(E.envMapCubeUVHeight),_.push(E.mapUv),_.push(E.alphaMapUv),_.push(E.lightMapUv),_.push(E.aoMapUv),_.push(E.bumpMapUv),_.push(E.normalMapUv),_.push(E.displacementMapUv),_.push(E.emissiveMapUv),_.push(E.metalnessMapUv),_.push(E.roughnessMapUv),_.push(E.anisotropyMapUv),_.push(E.clearcoatMapUv),_.push(E.clearcoatNormalMapUv),_.push(E.clearcoatRoughnessMapUv),_.push(E.iridescenceMapUv),_.push(E.iridescenceThicknessMapUv),_.push(E.sheenColorMapUv),_.push(E.sheenRoughnessMapUv),_.push(E.specularMapUv),_.push(E.specularColorMapUv),_.push(E.specularIntensityMapUv),_.push(E.transmissionMapUv),_.push(E.thicknessMapUv),_.push(E.combine),_.push(E.fogExp2),_.push(E.sizeAttenuation),_.push(E.morphTargetsCount),_.push(E.morphAttributeCount),_.push(E.numDirLights),_.push(E.numPointLights),_.push(E.numSpotLights),_.push(E.numSpotLightMaps),_.push(E.numHemiLights),_.push(E.numRectAreaLights),_.push(E.numDirLightShadows),_.push(E.numPointLightShadows),_.push(E.numSpotLightShadows),_.push(E.numSpotLightShadowsWithMaps),_.push(E.numLightProbes),_.push(E.shadowMapType),_.push(E.toneMapping),_.push(E.numClippingPlanes),_.push(E.numClipIntersection),_.push(E.depthPacking)}function S(_,E){a.disableAll(),E.instancing&&a.enable(0),E.instancingColor&&a.enable(1),E.instancingMorph&&a.enable(2),E.matcap&&a.enable(3),E.envMap&&a.enable(4),E.normalMapObjectSpace&&a.enable(5),E.normalMapTangentSpace&&a.enable(6),E.clearcoat&&a.enable(7),E.iridescence&&a.enable(8),E.alphaTest&&a.enable(9),E.vertexColors&&a.enable(10),E.vertexAlphas&&a.enable(11),E.vertexUv1s&&a.enable(12),E.vertexUv2s&&a.enable(13),E.vertexUv3s&&a.enable(14),E.vertexTangents&&a.enable(15),E.anisotropy&&a.enable(16),E.alphaHash&&a.enable(17),E.batching&&a.enable(18),E.dispersion&&a.enable(19),E.batchingColor&&a.enable(20),E.gradientMap&&a.enable(21),E.packedNormalMap&&a.enable(22),E.vertexNormals&&a.enable(23),_.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.reversedDepthBuffer&&a.enable(4),E.skinning&&a.enable(5),E.morphTargets&&a.enable(6),E.morphNormals&&a.enable(7),E.morphColors&&a.enable(8),E.premultipliedAlpha&&a.enable(9),E.shadowMapEnabled&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),E.decodeVideoTextureEmissive&&a.enable(20),E.alphaToCoverage&&a.enable(21),E.numLightProbeGrids>0&&a.enable(22),E.hasPositionAttribute&&a.enable(23),_.push(a.mask)}function w(_){let E=f[_.type],P;if(E){let I=Hn[E];P=Wu.clone(I.uniforms)}else P=_.uniforms;return P}function y(_,E){let P=h.get(E);return P!==void 0?++P.usedTimes:(P=new wx(i,E,_,s),c.push(P),h.set(E,P)),P}function A(_){if(--_.usedTimes===0){let E=c.indexOf(_);c[E]=c[c.length-1],c.pop(),h.delete(_.cacheKey),_.destroy()}}function R(_){o.remove(_)}function C(){o.dispose()}return{getParameters:b,getProgramCacheKey:m,getUniforms:w,acquireProgram:y,releaseProgram:A,releaseShaderCache:R,programs:c,dispose:C}}function Rx(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,l){i.get(a)[o]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function Cx(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.materialVariant!==e.materialVariant?i.materialVariant-e.materialVariant:i.z!==e.z?i.z-e.z:i.id-e.id}function hd(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function ud(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(d){let f=0;return d.isInstancedMesh&&(f+=2),d.isSkinnedMesh&&(f+=1),f}function o(d,f,x,b,m,p){let S=i[e];return S===void 0?(S={id:d.id,object:d,geometry:f,material:x,materialVariant:a(d),groupOrder:b,renderOrder:d.renderOrder,z:m,group:p},i[e]=S):(S.id=d.id,S.object=d,S.geometry=f,S.material=x,S.materialVariant=a(d),S.groupOrder=b,S.renderOrder=d.renderOrder,S.z=m,S.group=p),e++,S}function l(d,f,x,b,m,p){let S=o(d,f,x,b,m,p);x.transmission>0?n.push(S):x.transparent===!0?s.push(S):t.push(S)}function c(d,f,x,b,m,p){let S=o(d,f,x,b,m,p);x.transmission>0?n.unshift(S):x.transparent===!0?s.unshift(S):t.unshift(S)}function h(d,f,x){t.length>1&&t.sort(d||Cx),n.length>1&&n.sort(f||hd),s.length>1&&s.sort(f||hd),x&&(t.reverse(),n.reverse(),s.reverse())}function u(){for(let d=e,f=i.length;d<f;d++){let x=i[d];if(x.id===null)break;x.id=null,x.object=null,x.geometry=null,x.material=null,x.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:l,unshift:c,finish:u,sort:h}}function Px(){let i=new WeakMap;function e(n,s){let r=i.get(n),a;return r===void 0?(a=new ud,i.set(n,[a])):s>=r.length?(a=new ud,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function Ix(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new U,color:new dt};break;case"SpotLight":t={position:new U,direction:new U,color:new dt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new U,color:new dt,distance:0,decay:0};break;case"HemisphereLight":t={direction:new U,skyColor:new dt,groundColor:new dt};break;case"RectAreaLight":t={color:new dt,position:new U,halfWidth:new U,halfHeight:new U};break}return i[e.id]=t,t}}}function Lx(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var Fx=0;function Nx(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Dx(i){let e=new Ix,t=Lx(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new U);let s=new U,r=new Et,a=new Et;function o(c){let h=0,u=0,d=0;for(let E=0;E<9;E++)n.probe[E].set(0,0,0);let f=0,x=0,b=0,m=0,p=0,S=0,w=0,y=0,A=0,R=0,C=0;c.sort(Nx);for(let E=0,P=c.length;E<P;E++){let I=c[E],k=I.color,Y=I.intensity,J=I.distance,O=null;if(I.shadow&&I.shadow.map&&(I.shadow.map.texture.format===Mi?O=I.shadow.map.texture:O=I.shadow.map.depthTexture||I.shadow.map.texture),I.isAmbientLight)h+=k.r*Y,u+=k.g*Y,d+=k.b*Y;else if(I.isLightProbe){for(let $=0;$<9;$++)n.probe[$].addScaledVector(I.sh.coefficients[$],Y);C++}else if(I.isDirectionalLight){let $=e.get(I);if($.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){let V=I.shadow,ie=t.get(I);ie.shadowIntensity=V.intensity,ie.shadowBias=V.bias,ie.shadowNormalBias=V.normalBias,ie.shadowRadius=V.radius,ie.shadowMapSize=V.mapSize,n.directionalShadow[f]=ie,n.directionalShadowMap[f]=O,n.directionalShadowMatrix[f]=I.shadow.matrix,S++}n.directional[f]=$,f++}else if(I.isSpotLight){let $=e.get(I);$.position.setFromMatrixPosition(I.matrixWorld),$.color.copy(k).multiplyScalar(Y),$.distance=J,$.coneCos=Math.cos(I.angle),$.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),$.decay=I.decay,n.spot[b]=$;let V=I.shadow;if(I.map&&(n.spotLightMap[A]=I.map,A++,V.updateMatrices(I),I.castShadow&&R++),n.spotLightMatrix[b]=V.matrix,I.castShadow){let ie=t.get(I);ie.shadowIntensity=V.intensity,ie.shadowBias=V.bias,ie.shadowNormalBias=V.normalBias,ie.shadowRadius=V.radius,ie.shadowMapSize=V.mapSize,n.spotShadow[b]=ie,n.spotShadowMap[b]=O,y++}b++}else if(I.isRectAreaLight){let $=e.get(I);$.color.copy(k).multiplyScalar(Y),$.halfWidth.set(I.width*.5,0,0),$.halfHeight.set(0,I.height*.5,0),n.rectArea[m]=$,m++}else if(I.isPointLight){let $=e.get(I);if($.color.copy(I.color).multiplyScalar(I.intensity),$.distance=I.distance,$.decay=I.decay,I.castShadow){let V=I.shadow,ie=t.get(I);ie.shadowIntensity=V.intensity,ie.shadowBias=V.bias,ie.shadowNormalBias=V.normalBias,ie.shadowRadius=V.radius,ie.shadowMapSize=V.mapSize,ie.shadowCameraNear=V.camera.near,ie.shadowCameraFar=V.camera.far,n.pointShadow[x]=ie,n.pointShadowMap[x]=O,n.pointShadowMatrix[x]=I.shadow.matrix,w++}n.point[x]=$,x++}else if(I.isHemisphereLight){let $=e.get(I);$.skyColor.copy(I.color).multiplyScalar(Y),$.groundColor.copy(I.groundColor).multiplyScalar(Y),n.hemi[p]=$,p++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=Ce.LTC_FLOAT_1,n.rectAreaLTC2=Ce.LTC_FLOAT_2):(n.rectAreaLTC1=Ce.LTC_HALF_1,n.rectAreaLTC2=Ce.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let _=n.hash;(_.directionalLength!==f||_.pointLength!==x||_.spotLength!==b||_.rectAreaLength!==m||_.hemiLength!==p||_.numDirectionalShadows!==S||_.numPointShadows!==w||_.numSpotShadows!==y||_.numSpotMaps!==A||_.numLightProbes!==C)&&(n.directional.length=f,n.spot.length=b,n.rectArea.length=m,n.point.length=x,n.hemi.length=p,n.directionalShadow.length=S,n.directionalShadowMap.length=S,n.pointShadow.length=w,n.pointShadowMap.length=w,n.spotShadow.length=y,n.spotShadowMap.length=y,n.directionalShadowMatrix.length=S,n.pointShadowMatrix.length=w,n.spotLightMatrix.length=y+A-R,n.spotLightMap.length=A,n.numSpotLightShadowsWithMaps=R,n.numLightProbes=C,_.directionalLength=f,_.pointLength=x,_.spotLength=b,_.rectAreaLength=m,_.hemiLength=p,_.numDirectionalShadows=S,_.numPointShadows=w,_.numSpotShadows=y,_.numSpotMaps=A,_.numLightProbes=C,n.version=Fx++)}function l(c,h){let u=0,d=0,f=0,x=0,b=0,m=h.matrixWorldInverse;for(let p=0,S=c.length;p<S;p++){let w=c[p];if(w.isDirectionalLight){let y=n.directional[u];y.direction.setFromMatrixPosition(w.matrixWorld),s.setFromMatrixPosition(w.target.matrixWorld),y.direction.sub(s),y.direction.transformDirection(m),u++}else if(w.isSpotLight){let y=n.spot[f];y.position.setFromMatrixPosition(w.matrixWorld),y.position.applyMatrix4(m),y.direction.setFromMatrixPosition(w.matrixWorld),s.setFromMatrixPosition(w.target.matrixWorld),y.direction.sub(s),y.direction.transformDirection(m),f++}else if(w.isRectAreaLight){let y=n.rectArea[x];y.position.setFromMatrixPosition(w.matrixWorld),y.position.applyMatrix4(m),a.identity(),r.copy(w.matrixWorld),r.premultiply(m),a.extractRotation(r),y.halfWidth.set(w.width*.5,0,0),y.halfHeight.set(0,w.height*.5,0),y.halfWidth.applyMatrix4(a),y.halfHeight.applyMatrix4(a),x++}else if(w.isPointLight){let y=n.point[d];y.position.setFromMatrixPosition(w.matrixWorld),y.position.applyMatrix4(m),d++}else if(w.isHemisphereLight){let y=n.hemi[b];y.direction.setFromMatrixPosition(w.matrixWorld),y.direction.transformDirection(m),b++}}}return{setup:o,setupView:l,state:n}}function dd(i){let e=new Dx(i),t=[],n=[],s=[];function r(d){u.camera=d,t.length=0,n.length=0,s.length=0}function a(d){t.push(d)}function o(d){n.push(d)}function l(d){s.push(d)}function c(){e.setup(t)}function h(d){e.setupView(t,d)}let u={lightsArray:t,shadowsArray:n,lightProbeGridArray:s,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:u,setupLights:c,setupLightsView:h,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function Ux(i){let e=new WeakMap;function t(s,r=0){let a=e.get(s),o;return a===void 0?(o=new dd(i),e.set(s,[o])):r>=a.length?(o=new dd(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}var Ox=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Bx=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,zx=[new U(1,0,0),new U(-1,0,0),new U(0,1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1)],kx=[new U(0,-1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1),new U(0,-1,0),new U(0,-1,0)],fd=new Et,Br=new U,Dc=new U;function Vx(i,e,t){let n=new _s,s=new we,r=new we,a=new Rt,o=new Za,l=new Ja,c={},h=t.maxTextureSize,u={[Jn]:Zt,[Zt]:Jn,[rn]:rn},d=new pn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new we},radius:{value:4}},vertexShader:Ox,fragmentShader:Bx}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let x=new Nt;x.setAttribute("position",new tn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let b=new vt(x,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=ki;let p=this.type;this.render=function(R,C,_){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||R.length===0)return;this.type===ru&&(tt("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=ki);let E=i.getRenderTarget(),P=i.getActiveCubeFace(),I=i.getActiveMipmapLevel(),k=i.state;k.setBlending(zn),k.buffers.depth.getReversed()===!0?k.buffers.color.setClear(0,0,0,0):k.buffers.color.setClear(1,1,1,1),k.buffers.depth.setTest(!0),k.setScissorTest(!1);let Y=p!==this.type;Y&&C.traverse(function(J){J.material&&(Array.isArray(J.material)?J.material.forEach(O=>O.needsUpdate=!0):J.material.needsUpdate=!0)});for(let J=0,O=R.length;J<O;J++){let $=R[J],V=$.shadow;if(V===void 0){tt("WebGLShadowMap:",$,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;s.copy(V.mapSize);let ie=V.getFrameExtents();s.multiply(ie),r.copy(V.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/ie.x),s.x=r.x*ie.x,V.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/ie.y),s.y=r.y*ie.y,V.mapSize.y=r.y));let he=i.state.buffers.depth.getReversed();if(V.camera._reversedDepth=he,V.map===null||Y===!0){if(V.map!==null&&(V.map.depthTexture!==null&&(V.map.depthTexture.dispose(),V.map.depthTexture=null),V.map.dispose()),this.type===Es){if($.isPointLight){tt("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}V.map=new dn(s.x,s.y,{format:Mi,type:kn,minFilter:Ht,magFilter:Ht,generateMipmaps:!1}),V.map.texture.name=$.name+".shadowMap",V.map.depthTexture=new Qn(s.x,s.y,vn),V.map.depthTexture.name=$.name+".shadowMapDepth",V.map.depthTexture.format=Nn,V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=kt,V.map.depthTexture.magFilter=kt}else $.isPointLight?(V.map=new il(s.x),V.map.depthTexture=new ka(s.x,Rn)):(V.map=new dn(s.x,s.y),V.map.depthTexture=new Qn(s.x,s.y,Rn)),V.map.depthTexture.name=$.name+".shadowMap",V.map.depthTexture.format=Nn,this.type===ki?(V.map.depthTexture.compareFunction=he?Qo:jo,V.map.depthTexture.minFilter=Ht,V.map.depthTexture.magFilter=Ht):(V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=kt,V.map.depthTexture.magFilter=kt);V.camera.updateProjectionMatrix()}let xe=V.map.isWebGLCubeRenderTarget?6:1;for(let ce=0;ce<xe;ce++){if(V.map.isWebGLCubeRenderTarget)i.setRenderTarget(V.map,ce),i.clear();else{ce===0&&(i.setRenderTarget(V.map),i.clear());let pe=V.getViewport(ce);a.set(r.x*pe.x,r.y*pe.y,r.x*pe.z,r.y*pe.w),k.viewport(a)}if($.isPointLight){let pe=V.camera,nt=V.matrix,st=$.distance||pe.far;st!==pe.far&&(pe.far=st,pe.updateProjectionMatrix()),Br.setFromMatrixPosition($.matrixWorld),pe.position.copy(Br),Dc.copy(pe.position),Dc.add(zx[ce]),pe.up.copy(kx[ce]),pe.lookAt(Dc),pe.updateMatrixWorld(),nt.makeTranslation(-Br.x,-Br.y,-Br.z),fd.multiplyMatrices(pe.projectionMatrix,pe.matrixWorldInverse),V._frustum.setFromProjectionMatrix(fd,pe.coordinateSystem,pe.reversedDepth)}else V.updateMatrices($);n=V.getFrustum(),y(C,_,V.camera,$,this.type)}V.isPointLightShadow!==!0&&this.type===Es&&S(V,_),V.needsUpdate=!1}p=this.type,m.needsUpdate=!1,i.setRenderTarget(E,P,I)};function S(R,C){let _=e.update(b);d.defines.VSM_SAMPLES!==R.blurSamples&&(d.defines.VSM_SAMPLES=R.blurSamples,f.defines.VSM_SAMPLES=R.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),R.mapPass===null&&(R.mapPass=new dn(s.x,s.y,{format:Mi,type:kn})),d.uniforms.shadow_pass.value=R.map.depthTexture,d.uniforms.resolution.value=R.mapSize,d.uniforms.radius.value=R.radius,i.setRenderTarget(R.mapPass),i.clear(),i.renderBufferDirect(C,null,_,d,b,null),f.uniforms.shadow_pass.value=R.mapPass.texture,f.uniforms.resolution.value=R.mapSize,f.uniforms.radius.value=R.radius,i.setRenderTarget(R.map),i.clear(),i.renderBufferDirect(C,null,_,f,b,null)}function w(R,C,_,E){let P=null,I=_.isPointLight===!0?R.customDistanceMaterial:R.customDepthMaterial;if(I!==void 0)P=I;else if(P=_.isPointLight===!0?l:o,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let k=P.uuid,Y=C.uuid,J=c[k];J===void 0&&(J={},c[k]=J);let O=J[Y];O===void 0&&(O=P.clone(),J[Y]=O,C.addEventListener("dispose",A)),P=O}if(P.visible=C.visible,P.wireframe=C.wireframe,E===Es?P.side=C.shadowSide!==null?C.shadowSide:C.side:P.side=C.shadowSide!==null?C.shadowSide:u[C.side],P.alphaMap=C.alphaMap,P.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,P.map=C.map,P.clipShadows=C.clipShadows,P.clippingPlanes=C.clippingPlanes,P.clipIntersection=C.clipIntersection,P.displacementMap=C.displacementMap,P.displacementScale=C.displacementScale,P.displacementBias=C.displacementBias,P.wireframeLinewidth=C.wireframeLinewidth,P.linewidth=C.linewidth,_.isPointLight===!0&&P.isMeshDistanceMaterial===!0){let k=i.properties.get(P);k.light=_}return P}function y(R,C,_,E,P){if(R.visible===!1)return;if(R.layers.test(C.layers)&&(R.isMesh||R.isLine||R.isPoints)&&(R.castShadow||R.receiveShadow&&P===Es)&&(!R.frustumCulled||n.intersectsObject(R))){R.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,R.matrixWorld);let Y=e.update(R),J=R.material;if(Array.isArray(J)){let O=Y.groups;for(let $=0,V=O.length;$<V;$++){let ie=O[$],he=J[ie.materialIndex];if(he&&he.visible){let xe=w(R,he,E,P);R.onBeforeShadow(i,R,C,_,Y,xe,ie),i.renderBufferDirect(_,null,Y,xe,R,ie),R.onAfterShadow(i,R,C,_,Y,xe,ie)}}}else if(J.visible){let O=w(R,J,E,P);R.onBeforeShadow(i,R,C,_,Y,O,null),i.renderBufferDirect(_,null,Y,O,R,null),R.onAfterShadow(i,R,C,_,Y,O,null)}}let k=R.children;for(let Y=0,J=k.length;Y<J;Y++)y(k[Y],C,_,E,P)}function A(R){R.target.removeEventListener("dispose",A);for(let _ in c){let E=c[_],P=R.target.uuid;P in E&&(E[P].dispose(),delete E[P])}}}function Hx(i,e){function t(){let D=!1,_e=new Rt,se=null,Te=new Rt(0,0,0,0);return{setMask:function(Ie){se!==Ie&&!D&&(i.colorMask(Ie,Ie,Ie,Ie),se=Ie)},setLocked:function(Ie){D=Ie},setClear:function(Ie,oe,Ve,Be,_t){_t===!0&&(Ie*=Be,oe*=Be,Ve*=Be),_e.set(Ie,oe,Ve,Be),Te.equals(_e)===!1&&(i.clearColor(Ie,oe,Ve,Be),Te.copy(_e))},reset:function(){D=!1,se=null,Te.set(-1,0,0,0)}}}function n(){let D=!1,_e=!1,se=null,Te=null,Ie=null;return{setReversed:function(oe){if(_e!==oe){let Ve=e.get("EXT_clip_control");oe?Ve.clipControlEXT(Ve.LOWER_LEFT_EXT,Ve.ZERO_TO_ONE_EXT):Ve.clipControlEXT(Ve.LOWER_LEFT_EXT,Ve.NEGATIVE_ONE_TO_ONE_EXT),_e=oe;let Be=Ie;Ie=null,this.setClear(Be)}},getReversed:function(){return _e},setTest:function(oe){oe?le(i.DEPTH_TEST):Ne(i.DEPTH_TEST)},setMask:function(oe){se!==oe&&!D&&(i.depthMask(oe),se=oe)},setFunc:function(oe){if(_e&&(oe=Bu[oe]),Te!==oe){switch(oe){case Ea:i.depthFunc(i.NEVER);break;case Ta:i.depthFunc(i.ALWAYS);break;case Aa:i.depthFunc(i.LESS);break;case Ui:i.depthFunc(i.LEQUAL);break;case Ra:i.depthFunc(i.EQUAL);break;case Ca:i.depthFunc(i.GEQUAL);break;case Pa:i.depthFunc(i.GREATER);break;case Ia:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}Te=oe}},setLocked:function(oe){D=oe},setClear:function(oe){Ie!==oe&&(Ie=oe,_e&&(oe=1-oe),i.clearDepth(oe))},reset:function(){D=!1,se=null,Te=null,Ie=null,_e=!1}}}function s(){let D=!1,_e=null,se=null,Te=null,Ie=null,oe=null,Ve=null,Be=null,_t=null;return{setTest:function(yt){D||(yt?le(i.STENCIL_TEST):Ne(i.STENCIL_TEST))},setMask:function(yt){_e!==yt&&!D&&(i.stencilMask(yt),_e=yt)},setFunc:function(yt,Jt,Kt){(se!==yt||Te!==Jt||Ie!==Kt)&&(i.stencilFunc(yt,Jt,Kt),se=yt,Te=Jt,Ie=Kt)},setOp:function(yt,Jt,Kt){(oe!==yt||Ve!==Jt||Be!==Kt)&&(i.stencilOp(yt,Jt,Kt),oe=yt,Ve=Jt,Be=Kt)},setLocked:function(yt){D=yt},setClear:function(yt){_t!==yt&&(i.clearStencil(yt),_t=yt)},reset:function(){D=!1,_e=null,se=null,Te=null,Ie=null,oe=null,Ve=null,Be=null,_t=null}}}let r=new t,a=new n,o=new s,l=new WeakMap,c=new WeakMap,h={},u={},d={},f=new WeakMap,x=[],b=null,m=!1,p=null,S=null,w=null,y=null,A=null,R=null,C=null,_=new dt(0,0,0),E=0,P=!1,I=null,k=null,Y=null,J=null,O=null,$=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),V=!1,ie=0,he=i.getParameter(i.VERSION);he.indexOf("WebGL")!==-1?(ie=parseFloat(/^WebGL (\d)/.exec(he)[1]),V=ie>=1):he.indexOf("OpenGL ES")!==-1&&(ie=parseFloat(/^OpenGL ES (\d)/.exec(he)[1]),V=ie>=2);let xe=null,ce={},pe=i.getParameter(i.SCISSOR_BOX),nt=i.getParameter(i.VIEWPORT),st=new Rt().fromArray(pe),qe=new Rt().fromArray(nt);function ee(D,_e,se,Te){let Ie=new Uint8Array(4),oe=i.createTexture();i.bindTexture(D,oe),i.texParameteri(D,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(D,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ve=0;Ve<se;Ve++)D===i.TEXTURE_3D||D===i.TEXTURE_2D_ARRAY?i.texImage3D(_e,0,i.RGBA,1,1,Te,0,i.RGBA,i.UNSIGNED_BYTE,Ie):i.texImage2D(_e+Ve,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,Ie);return oe}let ve={};ve[i.TEXTURE_2D]=ee(i.TEXTURE_2D,i.TEXTURE_2D,1),ve[i.TEXTURE_CUBE_MAP]=ee(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),ve[i.TEXTURE_2D_ARRAY]=ee(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),ve[i.TEXTURE_3D]=ee(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),le(i.DEPTH_TEST),a.setFunc(Ui),ge(!1),de(rc),le(i.CULL_FACE),K(zn);function le(D){h[D]!==!0&&(i.enable(D),h[D]=!0)}function Ne(D){h[D]!==!1&&(i.disable(D),h[D]=!1)}function Pe(D,_e){return d[D]!==_e?(i.bindFramebuffer(D,_e),d[D]=_e,D===i.DRAW_FRAMEBUFFER&&(d[i.FRAMEBUFFER]=_e),D===i.FRAMEBUFFER&&(d[i.DRAW_FRAMEBUFFER]=_e),!0):!1}function Ee(D,_e){let se=x,Te=!1;if(D){se=f.get(_e),se===void 0&&(se=[],f.set(_e,se));let Ie=D.textures;if(se.length!==Ie.length||se[0]!==i.COLOR_ATTACHMENT0){for(let oe=0,Ve=Ie.length;oe<Ve;oe++)se[oe]=i.COLOR_ATTACHMENT0+oe;se.length=Ie.length,Te=!0}}else se[0]!==i.BACK&&(se[0]=i.BACK,Te=!0);Te&&i.drawBuffers(se)}function Ye(D){return b!==D?(i.useProgram(D),b=D,!0):!1}let Ue={[fi]:i.FUNC_ADD,[ou]:i.FUNC_SUBTRACT,[lu]:i.FUNC_REVERSE_SUBTRACT};Ue[cu]=i.MIN,Ue[hu]=i.MAX;let H={[uu]:i.ZERO,[du]:i.ONE,[fu]:i.SRC_COLOR,[Sa]:i.SRC_ALPHA,[yu]:i.SRC_ALPHA_SATURATE,[xu]:i.DST_COLOR,[mu]:i.DST_ALPHA,[pu]:i.ONE_MINUS_SRC_COLOR,[wa]:i.ONE_MINUS_SRC_ALPHA,[_u]:i.ONE_MINUS_DST_COLOR,[gu]:i.ONE_MINUS_DST_ALPHA,[vu]:i.CONSTANT_COLOR,[bu]:i.ONE_MINUS_CONSTANT_COLOR,[Mu]:i.CONSTANT_ALPHA,[Su]:i.ONE_MINUS_CONSTANT_ALPHA};function K(D,_e,se,Te,Ie,oe,Ve,Be,_t,yt){if(D===zn){m===!0&&(Ne(i.BLEND),m=!1);return}if(m===!1&&(le(i.BLEND),m=!0),D!==au){if(D!==p||yt!==P){if((S!==fi||A!==fi)&&(i.blendEquation(i.FUNC_ADD),S=fi,A=fi),yt)switch(D){case Di:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ac:i.blendFunc(i.ONE,i.ONE);break;case oc:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case lc:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:it("WebGLState: Invalid blending: ",D);break}else switch(D){case Di:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ac:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case oc:it("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case lc:it("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:it("WebGLState: Invalid blending: ",D);break}w=null,y=null,R=null,C=null,_.set(0,0,0),E=0,p=D,P=yt}return}Ie=Ie||_e,oe=oe||se,Ve=Ve||Te,(_e!==S||Ie!==A)&&(i.blendEquationSeparate(Ue[_e],Ue[Ie]),S=_e,A=Ie),(se!==w||Te!==y||oe!==R||Ve!==C)&&(i.blendFuncSeparate(H[se],H[Te],H[oe],H[Ve]),w=se,y=Te,R=oe,C=Ve),(Be.equals(_)===!1||_t!==E)&&(i.blendColor(Be.r,Be.g,Be.b,_t),_.copy(Be),E=_t),p=D,P=!1}function te(D,_e){D.side===rn?Ne(i.CULL_FACE):le(i.CULL_FACE);let se=D.side===Zt;_e&&(se=!se),ge(se),D.blending===Di&&D.transparent===!1?K(zn):K(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),a.setFunc(D.depthFunc),a.setTest(D.depthTest),a.setMask(D.depthWrite),r.setMask(D.colorWrite);let Te=D.stencilWrite;o.setTest(Te),Te&&(o.setMask(D.stencilWriteMask),o.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),o.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),He(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?le(i.SAMPLE_ALPHA_TO_COVERAGE):Ne(i.SAMPLE_ALPHA_TO_COVERAGE)}function ge(D){I!==D&&(D?i.frontFace(i.CW):i.frontFace(i.CCW),I=D)}function de(D){D!==iu?(le(i.CULL_FACE),D!==k&&(D===rc?i.cullFace(i.BACK):D===su?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Ne(i.CULL_FACE),k=D}function We(D){D!==Y&&(V&&i.lineWidth(D),Y=D)}function He(D,_e,se){D?(le(i.POLYGON_OFFSET_FILL),(J!==_e||O!==se)&&(J=_e,O=se,a.getReversed()&&(_e=-_e),i.polygonOffset(_e,se))):Ne(i.POLYGON_OFFSET_FILL)}function je(D){D?le(i.SCISSOR_TEST):Ne(i.SCISSOR_TEST)}function L(D){D===void 0&&(D=i.TEXTURE0+$-1),xe!==D&&(i.activeTexture(D),xe=D)}function T(D,_e,se){se===void 0&&(xe===null?se=i.TEXTURE0+$-1:se=xe);let Te=ce[se];Te===void 0&&(Te={type:void 0,texture:void 0},ce[se]=Te),(Te.type!==D||Te.texture!==_e)&&(xe!==se&&(i.activeTexture(se),xe=se),i.bindTexture(D,_e||ve[D]),Te.type=D,Te.texture=_e)}function j(){let D=ce[xe];D!==void 0&&D.type!==void 0&&(i.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function ue(){try{i.compressedTexImage2D(...arguments)}catch(D){it("WebGLState:",D)}}function M(){try{i.compressedTexImage3D(...arguments)}catch(D){it("WebGLState:",D)}}function g(){try{i.texSubImage2D(...arguments)}catch(D){it("WebGLState:",D)}}function F(){try{i.texSubImage3D(...arguments)}catch(D){it("WebGLState:",D)}}function z(){try{i.compressedTexSubImage2D(...arguments)}catch(D){it("WebGLState:",D)}}function G(){try{i.compressedTexSubImage3D(...arguments)}catch(D){it("WebGLState:",D)}}function re(){try{i.texStorage2D(...arguments)}catch(D){it("WebGLState:",D)}}function fe(){try{i.texStorage3D(...arguments)}catch(D){it("WebGLState:",D)}}function Q(){try{i.texImage2D(...arguments)}catch(D){it("WebGLState:",D)}}function ne(){try{i.texImage3D(...arguments)}catch(D){it("WebGLState:",D)}}function be(D){return u[D]!==void 0?u[D]:i.getParameter(D)}function ke(D,_e){u[D]!==_e&&(i.pixelStorei(D,_e),u[D]=_e)}function Ae(D){st.equals(D)===!1&&(i.scissor(D.x,D.y,D.z,D.w),st.copy(D))}function Me(D){qe.equals(D)===!1&&(i.viewport(D.x,D.y,D.z,D.w),qe.copy(D))}function Ge(D,_e){let se=c.get(_e);se===void 0&&(se=new WeakMap,c.set(_e,se));let Te=se.get(D);Te===void 0&&(Te=i.getUniformBlockIndex(_e,D.name),se.set(D,Te))}function Je(D,_e){let Te=c.get(_e).get(D);l.get(_e)!==Te&&(i.uniformBlockBinding(_e,Te,D.__bindingPointIndex),l.set(_e,Te))}function Ke(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),h={},u={},xe=null,ce={},d={},f=new WeakMap,x=[],b=null,m=!1,p=null,S=null,w=null,y=null,A=null,R=null,C=null,_=new dt(0,0,0),E=0,P=!1,I=null,k=null,Y=null,J=null,O=null,st.set(0,0,i.canvas.width,i.canvas.height),qe.set(0,0,i.canvas.width,i.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:le,disable:Ne,bindFramebuffer:Pe,drawBuffers:Ee,useProgram:Ye,setBlending:K,setMaterial:te,setFlipSided:ge,setCullFace:de,setLineWidth:We,setPolygonOffset:He,setScissorTest:je,activeTexture:L,bindTexture:T,unbindTexture:j,compressedTexImage2D:ue,compressedTexImage3D:M,texImage2D:Q,texImage3D:ne,pixelStorei:ke,getParameter:be,updateUBOMapping:Ge,uniformBlockBinding:Je,texStorage2D:re,texStorage3D:fe,texSubImage2D:g,texSubImage3D:F,compressedTexSubImage2D:z,compressedTexSubImage3D:G,scissor:Ae,viewport:Me,reset:Ke}}function Gx(i,e,t,n,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new we,h=new WeakMap,u=new Set,d,f=new WeakMap,x=!1;try{x=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function b(M,g){return x?new OffscreenCanvas(M,g):tr("canvas")}function m(M,g,F){let z=1,G=ue(M);if((G.width>F||G.height>F)&&(z=F/Math.max(G.width,G.height)),z<1)if(typeof HTMLImageElement<"u"&&M instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&M instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&M instanceof ImageBitmap||typeof VideoFrame<"u"&&M instanceof VideoFrame){let re=Math.floor(z*G.width),fe=Math.floor(z*G.height);d===void 0&&(d=b(re,fe));let Q=g?b(re,fe):d;return Q.width=re,Q.height=fe,Q.getContext("2d").drawImage(M,0,0,re,fe),tt("WebGLRenderer: Texture has been resized from ("+G.width+"x"+G.height+") to ("+re+"x"+fe+")."),Q}else return"data"in M&&tt("WebGLRenderer: Image in DataTexture is too big ("+G.width+"x"+G.height+")."),M;return M}function p(M){return M.generateMipmaps}function S(M){i.generateMipmap(M)}function w(M){return M.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:M.isWebGL3DRenderTarget?i.TEXTURE_3D:M.isWebGLArrayRenderTarget||M.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function y(M,g,F,z,G,re=!1){if(M!==null){if(i[M]!==void 0)return i[M];tt("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+M+"'")}let fe;z&&(fe=e.get("EXT_texture_norm16"),fe||tt("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Q=g;if(g===i.RED&&(F===i.FLOAT&&(Q=i.R32F),F===i.HALF_FLOAT&&(Q=i.R16F),F===i.UNSIGNED_BYTE&&(Q=i.R8),F===i.UNSIGNED_SHORT&&fe&&(Q=fe.R16_EXT),F===i.SHORT&&fe&&(Q=fe.R16_SNORM_EXT)),g===i.RED_INTEGER&&(F===i.UNSIGNED_BYTE&&(Q=i.R8UI),F===i.UNSIGNED_SHORT&&(Q=i.R16UI),F===i.UNSIGNED_INT&&(Q=i.R32UI),F===i.BYTE&&(Q=i.R8I),F===i.SHORT&&(Q=i.R16I),F===i.INT&&(Q=i.R32I)),g===i.RG&&(F===i.FLOAT&&(Q=i.RG32F),F===i.HALF_FLOAT&&(Q=i.RG16F),F===i.UNSIGNED_BYTE&&(Q=i.RG8),F===i.UNSIGNED_SHORT&&fe&&(Q=fe.RG16_EXT),F===i.SHORT&&fe&&(Q=fe.RG16_SNORM_EXT)),g===i.RG_INTEGER&&(F===i.UNSIGNED_BYTE&&(Q=i.RG8UI),F===i.UNSIGNED_SHORT&&(Q=i.RG16UI),F===i.UNSIGNED_INT&&(Q=i.RG32UI),F===i.BYTE&&(Q=i.RG8I),F===i.SHORT&&(Q=i.RG16I),F===i.INT&&(Q=i.RG32I)),g===i.RGB_INTEGER&&(F===i.UNSIGNED_BYTE&&(Q=i.RGB8UI),F===i.UNSIGNED_SHORT&&(Q=i.RGB16UI),F===i.UNSIGNED_INT&&(Q=i.RGB32UI),F===i.BYTE&&(Q=i.RGB8I),F===i.SHORT&&(Q=i.RGB16I),F===i.INT&&(Q=i.RGB32I)),g===i.RGBA_INTEGER&&(F===i.UNSIGNED_BYTE&&(Q=i.RGBA8UI),F===i.UNSIGNED_SHORT&&(Q=i.RGBA16UI),F===i.UNSIGNED_INT&&(Q=i.RGBA32UI),F===i.BYTE&&(Q=i.RGBA8I),F===i.SHORT&&(Q=i.RGBA16I),F===i.INT&&(Q=i.RGBA32I)),g===i.RGB&&(F===i.UNSIGNED_SHORT&&fe&&(Q=fe.RGB16_EXT),F===i.SHORT&&fe&&(Q=fe.RGB16_SNORM_EXT),F===i.UNSIGNED_INT_5_9_9_9_REV&&(Q=i.RGB9_E5),F===i.UNSIGNED_INT_10F_11F_11F_REV&&(Q=i.R11F_G11F_B10F)),g===i.RGBA){let ne=re?er:mt.getTransfer(G);F===i.FLOAT&&(Q=i.RGBA32F),F===i.HALF_FLOAT&&(Q=i.RGBA16F),F===i.UNSIGNED_BYTE&&(Q=ne===bt?i.SRGB8_ALPHA8:i.RGBA8),F===i.UNSIGNED_SHORT&&fe&&(Q=fe.RGBA16_EXT),F===i.SHORT&&fe&&(Q=fe.RGBA16_SNORM_EXT),F===i.UNSIGNED_SHORT_4_4_4_4&&(Q=i.RGBA4),F===i.UNSIGNED_SHORT_5_5_5_1&&(Q=i.RGB5_A1)}return(Q===i.R16F||Q===i.R32F||Q===i.RG16F||Q===i.RG32F||Q===i.RGBA16F||Q===i.RGBA32F)&&e.get("EXT_color_buffer_float"),Q}function A(M,g){let F;return M?g===null||g===Rn||g===As?F=i.DEPTH24_STENCIL8:g===vn?F=i.DEPTH32F_STENCIL8:g===Ts&&(F=i.DEPTH24_STENCIL8,tt("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):g===null||g===Rn||g===As?F=i.DEPTH_COMPONENT24:g===vn?F=i.DEPTH_COMPONENT32F:g===Ts&&(F=i.DEPTH_COMPONENT16),F}function R(M,g){return p(M)===!0||M.isFramebufferTexture&&M.minFilter!==kt&&M.minFilter!==Ht?Math.log2(Math.max(g.width,g.height))+1:M.mipmaps!==void 0&&M.mipmaps.length>0?M.mipmaps.length:M.isCompressedTexture&&Array.isArray(M.image)?g.mipmaps.length:1}function C(M){let g=M.target;g.removeEventListener("dispose",C),E(g),g.isVideoTexture&&h.delete(g),g.isHTMLTexture&&u.delete(g)}function _(M){let g=M.target;g.removeEventListener("dispose",_),I(g)}function E(M){let g=n.get(M);if(g.__webglInit===void 0)return;let F=M.source,z=f.get(F);if(z){let G=z[g.__cacheKey];G.usedTimes--,G.usedTimes===0&&P(M),Object.keys(z).length===0&&f.delete(F)}n.remove(M)}function P(M){let g=n.get(M);i.deleteTexture(g.__webglTexture);let F=M.source,z=f.get(F);delete z[g.__cacheKey],a.memory.textures--}function I(M){let g=n.get(M);if(M.depthTexture&&(M.depthTexture.dispose(),n.remove(M.depthTexture)),M.isWebGLCubeRenderTarget)for(let z=0;z<6;z++){if(Array.isArray(g.__webglFramebuffer[z]))for(let G=0;G<g.__webglFramebuffer[z].length;G++)i.deleteFramebuffer(g.__webglFramebuffer[z][G]);else i.deleteFramebuffer(g.__webglFramebuffer[z]);g.__webglDepthbuffer&&i.deleteRenderbuffer(g.__webglDepthbuffer[z])}else{if(Array.isArray(g.__webglFramebuffer))for(let z=0;z<g.__webglFramebuffer.length;z++)i.deleteFramebuffer(g.__webglFramebuffer[z]);else i.deleteFramebuffer(g.__webglFramebuffer);if(g.__webglDepthbuffer&&i.deleteRenderbuffer(g.__webglDepthbuffer),g.__webglMultisampledFramebuffer&&i.deleteFramebuffer(g.__webglMultisampledFramebuffer),g.__webglColorRenderbuffer)for(let z=0;z<g.__webglColorRenderbuffer.length;z++)g.__webglColorRenderbuffer[z]&&i.deleteRenderbuffer(g.__webglColorRenderbuffer[z]);g.__webglDepthRenderbuffer&&i.deleteRenderbuffer(g.__webglDepthRenderbuffer)}let F=M.textures;for(let z=0,G=F.length;z<G;z++){let re=n.get(F[z]);re.__webglTexture&&(i.deleteTexture(re.__webglTexture),a.memory.textures--),n.remove(F[z])}n.remove(M)}let k=0;function Y(){k=0}function J(){return k}function O(M){k=M}function $(){let M=k;return M>=s.maxTextures&&tt("WebGLTextures: Trying to use "+M+" texture units while this GPU supports only "+s.maxTextures),k+=1,M}function V(M){let g=[];return g.push(M.wrapS),g.push(M.wrapT),g.push(M.wrapR||0),g.push(M.magFilter),g.push(M.minFilter),g.push(M.anisotropy),g.push(M.internalFormat),g.push(M.format),g.push(M.type),g.push(M.generateMipmaps),g.push(M.premultiplyAlpha),g.push(M.flipY),g.push(M.unpackAlignment),g.push(M.colorSpace),g.join()}function ie(M,g){let F=n.get(M);if(M.isVideoTexture&&T(M),M.isRenderTargetTexture===!1&&M.isExternalTexture!==!0&&M.version>0&&F.__version!==M.version){let z=M.image;if(z===null)tt("WebGLRenderer: Texture marked for update but no image data found.");else if(z.complete===!1)tt("WebGLRenderer: Texture marked for update but image is incomplete");else{Ne(F,M,g);return}}else M.isExternalTexture&&(F.__webglTexture=M.sourceTexture?M.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,F.__webglTexture,i.TEXTURE0+g)}function he(M,g){let F=n.get(M);if(M.isRenderTargetTexture===!1&&M.version>0&&F.__version!==M.version){Ne(F,M,g);return}else M.isExternalTexture&&(F.__webglTexture=M.sourceTexture?M.sourceTexture:null);t.bindTexture(i.TEXTURE_2D_ARRAY,F.__webglTexture,i.TEXTURE0+g)}function xe(M,g){let F=n.get(M);if(M.isRenderTargetTexture===!1&&M.version>0&&F.__version!==M.version){Ne(F,M,g);return}t.bindTexture(i.TEXTURE_3D,F.__webglTexture,i.TEXTURE0+g)}function ce(M,g){let F=n.get(M);if(M.isCubeDepthTexture!==!0&&M.version>0&&F.__version!==M.version){Pe(F,M,g);return}t.bindTexture(i.TEXTURE_CUBE_MAP,F.__webglTexture,i.TEXTURE0+g)}let pe={[La]:i.REPEAT,[Fn]:i.CLAMP_TO_EDGE,[Fa]:i.MIRRORED_REPEAT},nt={[kt]:i.NEAREST,[Tu]:i.NEAREST_MIPMAP_NEAREST,[Pr]:i.NEAREST_MIPMAP_LINEAR,[Ht]:i.LINEAR,[fo]:i.LINEAR_MIPMAP_NEAREST,[vi]:i.LINEAR_MIPMAP_LINEAR},st={[Cu]:i.NEVER,[Nu]:i.ALWAYS,[Pu]:i.LESS,[jo]:i.LEQUAL,[Iu]:i.EQUAL,[Qo]:i.GEQUAL,[Lu]:i.GREATER,[Fu]:i.NOTEQUAL};function qe(M,g){if(g.type===vn&&e.has("OES_texture_float_linear")===!1&&(g.magFilter===Ht||g.magFilter===fo||g.magFilter===Pr||g.magFilter===vi||g.minFilter===Ht||g.minFilter===fo||g.minFilter===Pr||g.minFilter===vi)&&tt("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(M,i.TEXTURE_WRAP_S,pe[g.wrapS]),i.texParameteri(M,i.TEXTURE_WRAP_T,pe[g.wrapT]),(M===i.TEXTURE_3D||M===i.TEXTURE_2D_ARRAY)&&i.texParameteri(M,i.TEXTURE_WRAP_R,pe[g.wrapR]),i.texParameteri(M,i.TEXTURE_MAG_FILTER,nt[g.magFilter]),i.texParameteri(M,i.TEXTURE_MIN_FILTER,nt[g.minFilter]),g.compareFunction&&(i.texParameteri(M,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(M,i.TEXTURE_COMPARE_FUNC,st[g.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(g.magFilter===kt||g.minFilter!==Pr&&g.minFilter!==vi||g.type===vn&&e.has("OES_texture_float_linear")===!1)return;if(g.anisotropy>1||n.get(g).__currentAnisotropy){let F=e.get("EXT_texture_filter_anisotropic");i.texParameterf(M,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(g.anisotropy,s.getMaxAnisotropy())),n.get(g).__currentAnisotropy=g.anisotropy}}}function ee(M,g){let F=!1;M.__webglInit===void 0&&(M.__webglInit=!0,g.addEventListener("dispose",C));let z=g.source,G=f.get(z);G===void 0&&(G={},f.set(z,G));let re=V(g);if(re!==M.__cacheKey){G[re]===void 0&&(G[re]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,F=!0),G[re].usedTimes++;let fe=G[M.__cacheKey];fe!==void 0&&(G[M.__cacheKey].usedTimes--,fe.usedTimes===0&&P(g)),M.__cacheKey=re,M.__webglTexture=G[re].texture}return F}function ve(M,g,F){return Math.floor(Math.floor(M/F)/g)}function le(M,g,F,z){let re=M.updateRanges;if(re.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,g.width,g.height,F,z,g.data);else{re.sort((ke,Ae)=>ke.start-Ae.start);let fe=0;for(let ke=1;ke<re.length;ke++){let Ae=re[fe],Me=re[ke],Ge=Ae.start+Ae.count,Je=ve(Me.start,g.width,4),Ke=ve(Ae.start,g.width,4);Me.start<=Ge+1&&Je===Ke&&ve(Me.start+Me.count-1,g.width,4)===Je?Ae.count=Math.max(Ae.count,Me.start+Me.count-Ae.start):(++fe,re[fe]=Me)}re.length=fe+1;let Q=t.getParameter(i.UNPACK_ROW_LENGTH),ne=t.getParameter(i.UNPACK_SKIP_PIXELS),be=t.getParameter(i.UNPACK_SKIP_ROWS);t.pixelStorei(i.UNPACK_ROW_LENGTH,g.width);for(let ke=0,Ae=re.length;ke<Ae;ke++){let Me=re[ke],Ge=Math.floor(Me.start/4),Je=Math.ceil(Me.count/4),Ke=Ge%g.width,D=Math.floor(Ge/g.width),_e=Je,se=1;t.pixelStorei(i.UNPACK_SKIP_PIXELS,Ke),t.pixelStorei(i.UNPACK_SKIP_ROWS,D),t.texSubImage2D(i.TEXTURE_2D,0,Ke,D,_e,se,F,z,g.data)}M.clearUpdateRanges(),t.pixelStorei(i.UNPACK_ROW_LENGTH,Q),t.pixelStorei(i.UNPACK_SKIP_PIXELS,ne),t.pixelStorei(i.UNPACK_SKIP_ROWS,be)}}function Ne(M,g,F){let z=i.TEXTURE_2D;(g.isDataArrayTexture||g.isCompressedArrayTexture)&&(z=i.TEXTURE_2D_ARRAY),g.isData3DTexture&&(z=i.TEXTURE_3D);let G=ee(M,g),re=g.source;t.bindTexture(z,M.__webglTexture,i.TEXTURE0+F);let fe=n.get(re);if(re.version!==fe.__version||G===!0){if(t.activeTexture(i.TEXTURE0+F),(typeof ImageBitmap<"u"&&g.image instanceof ImageBitmap)===!1){let se=mt.getPrimaries(mt.workingColorSpace),Te=g.colorSpace===ei?null:mt.getPrimaries(g.colorSpace),Ie=g.colorSpace===ei||se===Te?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,g.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,g.premultiplyAlpha),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ie)}t.pixelStorei(i.UNPACK_ALIGNMENT,g.unpackAlignment);let ne=m(g.image,!1,s.maxTextureSize);ne=j(g,ne);let be=r.convert(g.format,g.colorSpace),ke=r.convert(g.type),Ae=y(g.internalFormat,be,ke,g.normalized,g.colorSpace,g.isVideoTexture);qe(z,g);let Me,Ge=g.mipmaps,Je=g.isVideoTexture!==!0,Ke=fe.__version===void 0||G===!0,D=re.dataReady,_e=R(g,ne);if(g.isDepthTexture)Ae=A(g.format===bi,g.type),Ke&&(Je?t.texStorage2D(i.TEXTURE_2D,1,Ae,ne.width,ne.height):t.texImage2D(i.TEXTURE_2D,0,Ae,ne.width,ne.height,0,be,ke,null));else if(g.isDataTexture)if(Ge.length>0){Je&&Ke&&t.texStorage2D(i.TEXTURE_2D,_e,Ae,Ge[0].width,Ge[0].height);for(let se=0,Te=Ge.length;se<Te;se++)Me=Ge[se],Je?D&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,Me.width,Me.height,be,ke,Me.data):t.texImage2D(i.TEXTURE_2D,se,Ae,Me.width,Me.height,0,be,ke,Me.data);g.generateMipmaps=!1}else Je?(Ke&&t.texStorage2D(i.TEXTURE_2D,_e,Ae,ne.width,ne.height),D&&le(g,ne,be,ke)):t.texImage2D(i.TEXTURE_2D,0,Ae,ne.width,ne.height,0,be,ke,ne.data);else if(g.isCompressedTexture)if(g.isCompressedArrayTexture){Je&&Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,_e,Ae,Ge[0].width,Ge[0].height,ne.depth);for(let se=0,Te=Ge.length;se<Te;se++)if(Me=Ge[se],g.format!==bn)if(be!==null)if(Je){if(D)if(g.layerUpdates.size>0){let Ie=Cc(Me.width,Me.height,g.format,g.type);for(let oe of g.layerUpdates){let Ve=Me.data.subarray(oe*Ie/Me.data.BYTES_PER_ELEMENT,(oe+1)*Ie/Me.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,oe,Me.width,Me.height,1,be,Ve)}g.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,0,Me.width,Me.height,ne.depth,be,Me.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,se,Ae,Me.width,Me.height,ne.depth,0,Me.data,0,0);else tt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Je?D&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,0,Me.width,Me.height,ne.depth,be,ke,Me.data):t.texImage3D(i.TEXTURE_2D_ARRAY,se,Ae,Me.width,Me.height,ne.depth,0,be,ke,Me.data)}else{Je&&Ke&&t.texStorage2D(i.TEXTURE_2D,_e,Ae,Ge[0].width,Ge[0].height);for(let se=0,Te=Ge.length;se<Te;se++)Me=Ge[se],g.format!==bn?be!==null?Je?D&&t.compressedTexSubImage2D(i.TEXTURE_2D,se,0,0,Me.width,Me.height,be,Me.data):t.compressedTexImage2D(i.TEXTURE_2D,se,Ae,Me.width,Me.height,0,Me.data):tt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Je?D&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,Me.width,Me.height,be,ke,Me.data):t.texImage2D(i.TEXTURE_2D,se,Ae,Me.width,Me.height,0,be,ke,Me.data)}else if(g.isDataArrayTexture)if(Je){if(Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,_e,Ae,ne.width,ne.height,ne.depth),D)if(g.layerUpdates.size>0){let se=Cc(ne.width,ne.height,g.format,g.type);for(let Te of g.layerUpdates){let Ie=ne.data.subarray(Te*se/ne.data.BYTES_PER_ELEMENT,(Te+1)*se/ne.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,Te,ne.width,ne.height,1,be,ke,Ie)}g.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,ne.width,ne.height,ne.depth,be,ke,ne.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,Ae,ne.width,ne.height,ne.depth,0,be,ke,ne.data);else if(g.isData3DTexture)Je?(Ke&&t.texStorage3D(i.TEXTURE_3D,_e,Ae,ne.width,ne.height,ne.depth),D&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,ne.width,ne.height,ne.depth,be,ke,ne.data)):t.texImage3D(i.TEXTURE_3D,0,Ae,ne.width,ne.height,ne.depth,0,be,ke,ne.data);else if(g.isFramebufferTexture){if(Ke)if(Je)t.texStorage2D(i.TEXTURE_2D,_e,Ae,ne.width,ne.height);else{let se=ne.width,Te=ne.height;for(let Ie=0;Ie<_e;Ie++)t.texImage2D(i.TEXTURE_2D,Ie,Ae,se,Te,0,be,ke,null),se>>=1,Te>>=1}}else if(g.isHTMLTexture){if("texElementImage2D"in i){let se=i.canvas;if(se.hasAttribute("layoutsubtree")||se.setAttribute("layoutsubtree","true"),ne.parentNode!==se){se.appendChild(ne),u.add(g),se.onpaint=Te=>{let Ie=Te.changedElements;for(let oe of u)Ie.includes(oe.image)&&(oe.needsUpdate=!0)},se.requestPaint();return}if(i.texElementImage2D.length===3)i.texElementImage2D(i.TEXTURE_2D,i.RGBA8,ne);else{let Ie=i.RGBA,oe=i.RGBA,Ve=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,0,Ie,oe,Ve,ne)}i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(Ge.length>0){if(Je&&Ke){let se=ue(Ge[0]);t.texStorage2D(i.TEXTURE_2D,_e,Ae,se.width,se.height)}for(let se=0,Te=Ge.length;se<Te;se++)Me=Ge[se],Je?D&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,be,ke,Me):t.texImage2D(i.TEXTURE_2D,se,Ae,be,ke,Me);g.generateMipmaps=!1}else if(Je){if(Ke){let se=ue(ne);t.texStorage2D(i.TEXTURE_2D,_e,Ae,se.width,se.height)}D&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,be,ke,ne)}else t.texImage2D(i.TEXTURE_2D,0,Ae,be,ke,ne);p(g)&&S(z),fe.__version=re.version,g.onUpdate&&g.onUpdate(g)}M.__version=g.version}function Pe(M,g,F){if(g.image.length!==6)return;let z=ee(M,g),G=g.source;t.bindTexture(i.TEXTURE_CUBE_MAP,M.__webglTexture,i.TEXTURE0+F);let re=n.get(G);if(G.version!==re.__version||z===!0){t.activeTexture(i.TEXTURE0+F);let fe=mt.getPrimaries(mt.workingColorSpace),Q=g.colorSpace===ei?null:mt.getPrimaries(g.colorSpace),ne=g.colorSpace===ei||fe===Q?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,g.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,g.premultiplyAlpha),t.pixelStorei(i.UNPACK_ALIGNMENT,g.unpackAlignment),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,ne);let be=g.isCompressedTexture||g.image[0].isCompressedTexture,ke=g.image[0]&&g.image[0].isDataTexture,Ae=[];for(let oe=0;oe<6;oe++)!be&&!ke?Ae[oe]=m(g.image[oe],!0,s.maxCubemapSize):Ae[oe]=ke?g.image[oe].image:g.image[oe],Ae[oe]=j(g,Ae[oe]);let Me=Ae[0],Ge=r.convert(g.format,g.colorSpace),Je=r.convert(g.type),Ke=y(g.internalFormat,Ge,Je,g.normalized,g.colorSpace),D=g.isVideoTexture!==!0,_e=re.__version===void 0||z===!0,se=G.dataReady,Te=R(g,Me);qe(i.TEXTURE_CUBE_MAP,g);let Ie;if(be){D&&_e&&t.texStorage2D(i.TEXTURE_CUBE_MAP,Te,Ke,Me.width,Me.height);for(let oe=0;oe<6;oe++){Ie=Ae[oe].mipmaps;for(let Ve=0;Ve<Ie.length;Ve++){let Be=Ie[Ve];g.format!==bn?Ge!==null?D?se&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve,0,0,Be.width,Be.height,Ge,Be.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve,Ke,Be.width,Be.height,0,Be.data):tt("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve,0,0,Be.width,Be.height,Ge,Je,Be.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve,Ke,Be.width,Be.height,0,Ge,Je,Be.data)}}}else{if(Ie=g.mipmaps,D&&_e){Ie.length>0&&Te++;let oe=ue(Ae[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,Te,Ke,oe.width,oe.height)}for(let oe=0;oe<6;oe++)if(ke){D?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,Ae[oe].width,Ae[oe].height,Ge,Je,Ae[oe].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,Ke,Ae[oe].width,Ae[oe].height,0,Ge,Je,Ae[oe].data);for(let Ve=0;Ve<Ie.length;Ve++){let _t=Ie[Ve].image[oe].image;D?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve+1,0,0,_t.width,_t.height,Ge,Je,_t.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve+1,Ke,_t.width,_t.height,0,Ge,Je,_t.data)}}else{D?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,Ge,Je,Ae[oe]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,Ke,Ge,Je,Ae[oe]);for(let Ve=0;Ve<Ie.length;Ve++){let Be=Ie[Ve];D?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve+1,0,0,Ge,Je,Be.image[oe]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Ve+1,Ke,Ge,Je,Be.image[oe])}}}p(g)&&S(i.TEXTURE_CUBE_MAP),re.__version=G.version,g.onUpdate&&g.onUpdate(g)}M.__version=g.version}function Ee(M,g,F,z,G,re){let fe=r.convert(F.format,F.colorSpace),Q=r.convert(F.type),ne=y(F.internalFormat,fe,Q,F.normalized,F.colorSpace),be=n.get(g),ke=n.get(F);if(ke.__renderTarget=g,!be.__hasExternalTextures){let Ae=Math.max(1,g.width>>re),Me=Math.max(1,g.height>>re);G===i.TEXTURE_3D||G===i.TEXTURE_2D_ARRAY?t.texImage3D(G,re,ne,Ae,Me,g.depth,0,fe,Q,null):t.texImage2D(G,re,ne,Ae,Me,0,fe,Q,null)}t.bindFramebuffer(i.FRAMEBUFFER,M),L(g)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,z,G,ke.__webglTexture,0,je(g)):(G===i.TEXTURE_2D||G>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&G<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,z,G,ke.__webglTexture,re),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ye(M,g,F){if(i.bindRenderbuffer(i.RENDERBUFFER,M),g.depthBuffer){let z=g.depthTexture,G=z&&z.isDepthTexture?z.type:null,re=A(g.stencilBuffer,G),fe=g.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;L(g)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,je(g),re,g.width,g.height):F?i.renderbufferStorageMultisample(i.RENDERBUFFER,je(g),re,g.width,g.height):i.renderbufferStorage(i.RENDERBUFFER,re,g.width,g.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,fe,i.RENDERBUFFER,M)}else{let z=g.textures;for(let G=0;G<z.length;G++){let re=z[G],fe=r.convert(re.format,re.colorSpace),Q=r.convert(re.type),ne=y(re.internalFormat,fe,Q,re.normalized,re.colorSpace);L(g)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,je(g),ne,g.width,g.height):F?i.renderbufferStorageMultisample(i.RENDERBUFFER,je(g),ne,g.width,g.height):i.renderbufferStorage(i.RENDERBUFFER,ne,g.width,g.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ue(M,g,F){let z=g.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(i.FRAMEBUFFER,M),!(g.depthTexture&&g.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let G=n.get(g.depthTexture);if(G.__renderTarget=g,(!G.__webglTexture||g.depthTexture.image.width!==g.width||g.depthTexture.image.height!==g.height)&&(g.depthTexture.image.width=g.width,g.depthTexture.image.height=g.height,g.depthTexture.needsUpdate=!0),z){if(G.__webglInit===void 0&&(G.__webglInit=!0,g.depthTexture.addEventListener("dispose",C)),G.__webglTexture===void 0){G.__webglTexture=i.createTexture(),t.bindTexture(i.TEXTURE_CUBE_MAP,G.__webglTexture),qe(i.TEXTURE_CUBE_MAP,g.depthTexture);let be=r.convert(g.depthTexture.format),ke=r.convert(g.depthTexture.type),Ae;g.depthTexture.format===Nn?Ae=i.DEPTH_COMPONENT24:g.depthTexture.format===bi&&(Ae=i.DEPTH24_STENCIL8);for(let Me=0;Me<6;Me++)i.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Me,0,Ae,g.width,g.height,0,be,ke,null)}}else ie(g.depthTexture,0);let re=G.__webglTexture,fe=je(g),Q=z?i.TEXTURE_CUBE_MAP_POSITIVE_X+F:i.TEXTURE_2D,ne=g.depthTexture.format===bi?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(g.depthTexture.format===Nn)L(g)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ne,Q,re,0,fe):i.framebufferTexture2D(i.FRAMEBUFFER,ne,Q,re,0);else if(g.depthTexture.format===bi)L(g)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ne,Q,re,0,fe):i.framebufferTexture2D(i.FRAMEBUFFER,ne,Q,re,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function H(M){let g=n.get(M),F=M.isWebGLCubeRenderTarget===!0;if(g.__boundDepthTexture!==M.depthTexture){let z=M.depthTexture;if(g.__depthDisposeCallback&&g.__depthDisposeCallback(),z){let G=()=>{delete g.__boundDepthTexture,delete g.__depthDisposeCallback,z.removeEventListener("dispose",G)};z.addEventListener("dispose",G),g.__depthDisposeCallback=G}g.__boundDepthTexture=z}if(M.depthTexture&&!g.__autoAllocateDepthBuffer)if(F)for(let z=0;z<6;z++)Ue(g.__webglFramebuffer[z],M,z);else{let z=M.texture.mipmaps;z&&z.length>0?Ue(g.__webglFramebuffer[0],M,0):Ue(g.__webglFramebuffer,M,0)}else if(F){g.__webglDepthbuffer=[];for(let z=0;z<6;z++)if(t.bindFramebuffer(i.FRAMEBUFFER,g.__webglFramebuffer[z]),g.__webglDepthbuffer[z]===void 0)g.__webglDepthbuffer[z]=i.createRenderbuffer(),Ye(g.__webglDepthbuffer[z],M,!1);else{let G=M.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,re=g.__webglDepthbuffer[z];i.bindRenderbuffer(i.RENDERBUFFER,re),i.framebufferRenderbuffer(i.FRAMEBUFFER,G,i.RENDERBUFFER,re)}}else{let z=M.texture.mipmaps;if(z&&z.length>0?t.bindFramebuffer(i.FRAMEBUFFER,g.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,g.__webglFramebuffer),g.__webglDepthbuffer===void 0)g.__webglDepthbuffer=i.createRenderbuffer(),Ye(g.__webglDepthbuffer,M,!1);else{let G=M.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,re=g.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,re),i.framebufferRenderbuffer(i.FRAMEBUFFER,G,i.RENDERBUFFER,re)}}t.bindFramebuffer(i.FRAMEBUFFER,null)}function K(M,g,F){let z=n.get(M);g!==void 0&&Ee(z.__webglFramebuffer,M,M.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),F!==void 0&&H(M)}function te(M){let g=M.texture,F=n.get(M),z=n.get(g);M.addEventListener("dispose",_);let G=M.textures,re=M.isWebGLCubeRenderTarget===!0,fe=G.length>1;if(fe||(z.__webglTexture===void 0&&(z.__webglTexture=i.createTexture()),z.__version=g.version,a.memory.textures++),re){F.__webglFramebuffer=[];for(let Q=0;Q<6;Q++)if(g.mipmaps&&g.mipmaps.length>0){F.__webglFramebuffer[Q]=[];for(let ne=0;ne<g.mipmaps.length;ne++)F.__webglFramebuffer[Q][ne]=i.createFramebuffer()}else F.__webglFramebuffer[Q]=i.createFramebuffer()}else{if(g.mipmaps&&g.mipmaps.length>0){F.__webglFramebuffer=[];for(let Q=0;Q<g.mipmaps.length;Q++)F.__webglFramebuffer[Q]=i.createFramebuffer()}else F.__webglFramebuffer=i.createFramebuffer();if(fe)for(let Q=0,ne=G.length;Q<ne;Q++){let be=n.get(G[Q]);be.__webglTexture===void 0&&(be.__webglTexture=i.createTexture(),a.memory.textures++)}if(M.samples>0&&L(M)===!1){F.__webglMultisampledFramebuffer=i.createFramebuffer(),F.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let Q=0;Q<G.length;Q++){let ne=G[Q];F.__webglColorRenderbuffer[Q]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,F.__webglColorRenderbuffer[Q]);let be=r.convert(ne.format,ne.colorSpace),ke=r.convert(ne.type),Ae=y(ne.internalFormat,be,ke,ne.normalized,ne.colorSpace,M.isXRRenderTarget===!0),Me=je(M);i.renderbufferStorageMultisample(i.RENDERBUFFER,Me,Ae,M.width,M.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Q,i.RENDERBUFFER,F.__webglColorRenderbuffer[Q])}i.bindRenderbuffer(i.RENDERBUFFER,null),M.depthBuffer&&(F.__webglDepthRenderbuffer=i.createRenderbuffer(),Ye(F.__webglDepthRenderbuffer,M,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(re){t.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture),qe(i.TEXTURE_CUBE_MAP,g);for(let Q=0;Q<6;Q++)if(g.mipmaps&&g.mipmaps.length>0)for(let ne=0;ne<g.mipmaps.length;ne++)Ee(F.__webglFramebuffer[Q][ne],M,g,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,ne);else Ee(F.__webglFramebuffer[Q],M,g,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0);p(g)&&S(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(fe){for(let Q=0,ne=G.length;Q<ne;Q++){let be=G[Q],ke=n.get(be),Ae=i.TEXTURE_2D;(M.isWebGL3DRenderTarget||M.isWebGLArrayRenderTarget)&&(Ae=M.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(Ae,ke.__webglTexture),qe(Ae,be),Ee(F.__webglFramebuffer,M,be,i.COLOR_ATTACHMENT0+Q,Ae,0),p(be)&&S(Ae)}t.unbindTexture()}else{let Q=i.TEXTURE_2D;if((M.isWebGL3DRenderTarget||M.isWebGLArrayRenderTarget)&&(Q=M.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(Q,z.__webglTexture),qe(Q,g),g.mipmaps&&g.mipmaps.length>0)for(let ne=0;ne<g.mipmaps.length;ne++)Ee(F.__webglFramebuffer[ne],M,g,i.COLOR_ATTACHMENT0,Q,ne);else Ee(F.__webglFramebuffer,M,g,i.COLOR_ATTACHMENT0,Q,0);p(g)&&S(Q),t.unbindTexture()}M.depthBuffer&&H(M)}function ge(M){let g=M.textures;for(let F=0,z=g.length;F<z;F++){let G=g[F];if(p(G)){let re=w(M),fe=n.get(G).__webglTexture;t.bindTexture(re,fe),S(re),t.unbindTexture()}}}let de=[],We=[];function He(M){if(M.samples>0){if(L(M)===!1){let g=M.textures,F=M.width,z=M.height,G=i.COLOR_BUFFER_BIT,re=M.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,fe=n.get(M),Q=g.length>1;if(Q)for(let be=0;be<g.length;be++)t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,fe.__webglMultisampledFramebuffer);let ne=M.texture.mipmaps;ne&&ne.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglFramebuffer);for(let be=0;be<g.length;be++){if(M.resolveDepthBuffer&&(M.depthBuffer&&(G|=i.DEPTH_BUFFER_BIT),M.stencilBuffer&&M.resolveStencilBuffer&&(G|=i.STENCIL_BUFFER_BIT)),Q){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,fe.__webglColorRenderbuffer[be]);let ke=n.get(g[be]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,ke,0)}i.blitFramebuffer(0,0,F,z,0,0,F,z,G,i.NEAREST),l===!0&&(de.length=0,We.length=0,de.push(i.COLOR_ATTACHMENT0+be),M.depthBuffer&&M.resolveDepthBuffer===!1&&(de.push(re),We.push(re),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,We)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,de))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),Q)for(let be=0;be<g.length;be++){t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.RENDERBUFFER,fe.__webglColorRenderbuffer[be]);let ke=n.get(g[be]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.TEXTURE_2D,ke,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglMultisampledFramebuffer)}else if(M.depthBuffer&&M.resolveDepthBuffer===!1&&l){let g=M.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[g])}}}function je(M){return Math.min(s.maxSamples,M.samples)}function L(M){let g=n.get(M);return M.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&g.__useRenderToTexture!==!1}function T(M){let g=a.render.frame;h.get(M)!==g&&(h.set(M,g),M.update())}function j(M,g){let F=M.colorSpace,z=M.format,G=M.type;return M.isCompressedTexture===!0||M.isVideoTexture===!0||F!==Qs&&F!==ei&&(mt.getTransfer(F)===bt?(z!==bn||G!==an)&&tt("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):it("WebGLTextures: Unsupported texture color space:",F)),g}function ue(M){return typeof HTMLImageElement<"u"&&M instanceof HTMLImageElement?(c.width=M.naturalWidth||M.width,c.height=M.naturalHeight||M.height):typeof VideoFrame<"u"&&M instanceof VideoFrame?(c.width=M.displayWidth,c.height=M.displayHeight):(c.width=M.width,c.height=M.height),c}this.allocateTextureUnit=$,this.resetTextureUnits=Y,this.getTextureUnits=J,this.setTextureUnits=O,this.setTexture2D=ie,this.setTexture2DArray=he,this.setTexture3D=xe,this.setTextureCube=ce,this.rebindTextures=K,this.setupRenderTarget=te,this.updateRenderTargetMipmap=ge,this.updateMultisampleRenderTarget=He,this.setupDepthRenderbuffer=H,this.setupFrameBufferTexture=Ee,this.useMultisampledRTT=L,this.isReversedDepthBuffer=function(){return t.buffers.depth.getReversed()}}function Wx(i,e){function t(n,s=ei){let r,a=mt.getTransfer(s);if(n===an)return i.UNSIGNED_BYTE;if(n===mo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===go)return i.UNSIGNED_SHORT_5_5_5_1;if(n===yc)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===vc)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===xc)return i.BYTE;if(n===_c)return i.SHORT;if(n===Ts)return i.UNSIGNED_SHORT;if(n===po)return i.INT;if(n===Rn)return i.UNSIGNED_INT;if(n===vn)return i.FLOAT;if(n===kn)return i.HALF_FLOAT;if(n===bc)return i.ALPHA;if(n===Mc)return i.RGB;if(n===bn)return i.RGBA;if(n===Nn)return i.DEPTH_COMPONENT;if(n===bi)return i.DEPTH_STENCIL;if(n===xo)return i.RED;if(n===_o)return i.RED_INTEGER;if(n===Mi)return i.RG;if(n===yo)return i.RG_INTEGER;if(n===vo)return i.RGBA_INTEGER;if(n===Ir||n===Lr||n===Fr||n===Nr)if(a===bt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ir)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Lr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Fr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Nr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ir)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Lr)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Fr)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Nr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===bo||n===Mo||n===So||n===wo)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===bo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Mo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===So)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===wo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Eo||n===To||n===Ao||n===Ro||n===Co||n===Dr||n===Po)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Eo||n===To)return a===bt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===Ao)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===Ro)return r.COMPRESSED_R11_EAC;if(n===Co)return r.COMPRESSED_SIGNED_R11_EAC;if(n===Dr)return r.COMPRESSED_RG11_EAC;if(n===Po)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===Io||n===Lo||n===Fo||n===No||n===Do||n===Uo||n===Oo||n===Bo||n===zo||n===ko||n===Vo||n===Ho||n===Go||n===Wo)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===Io)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Lo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Fo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===No)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Do)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Uo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Oo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Bo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===zo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===ko)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Vo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Ho)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Go)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Wo)return a===bt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Xo||n===qo||n===Yo)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Xo)return a===bt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===qo)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Yo)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===$o||n===Zo||n===Ur||n===Jo)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===$o)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Zo)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Ur)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Jo)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===As?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var Xx=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,qx=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Gc=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new hr(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new pn({vertexShader:Xx,fragmentShader:qx,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new vt(new yn(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Wc=class extends Dn{constructor(e,t){super();let n=this,s=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,d=null,f=null,x=null,b=typeof XRWebGLBinding<"u",m=new Gc,p={},S=t.getContextAttributes(),w=null,y=null,A=[],R=[],C=new we,_=null,E=new Vt;E.viewport=new Rt;let P=new Vt;P.viewport=new Rt;let I=[E,P],k=new lo,Y=null,J=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(ee){let ve=A[ee];return ve===void 0&&(ve=new xs,A[ee]=ve),ve.getTargetRaySpace()},this.getControllerGrip=function(ee){let ve=A[ee];return ve===void 0&&(ve=new xs,A[ee]=ve),ve.getGripSpace()},this.getHand=function(ee){let ve=A[ee];return ve===void 0&&(ve=new xs,A[ee]=ve),ve.getHandSpace()};function O(ee){let ve=R.indexOf(ee.inputSource);if(ve===-1)return;let le=A[ve];le!==void 0&&(le.update(ee.inputSource,ee.frame,c||a),le.dispatchEvent({type:ee.type,data:ee.inputSource}))}function $(){s.removeEventListener("select",O),s.removeEventListener("selectstart",O),s.removeEventListener("selectend",O),s.removeEventListener("squeeze",O),s.removeEventListener("squeezestart",O),s.removeEventListener("squeezeend",O),s.removeEventListener("end",$),s.removeEventListener("inputsourceschange",V);for(let ee=0;ee<A.length;ee++){let ve=R[ee];ve!==null&&(R[ee]=null,A[ee].disconnect(ve))}Y=null,J=null,m.reset();for(let ee in p)delete p[ee];e.setRenderTarget(w),f=null,d=null,u=null,s=null,y=null,qe.stop(),n.isPresenting=!1,e.setPixelRatio(_),e.setSize(C.width,C.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(ee){r=ee,n.isPresenting===!0&&tt("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(ee){o=ee,n.isPresenting===!0&&tt("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(ee){c=ee},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u===null&&b&&(u=new XRWebGLBinding(s,t)),u},this.getFrame=function(){return x},this.getSession=function(){return s},this.setSession=async function(ee){if(s=ee,s!==null){if(w=e.getRenderTarget(),s.addEventListener("select",O),s.addEventListener("selectstart",O),s.addEventListener("selectend",O),s.addEventListener("squeeze",O),s.addEventListener("squeezestart",O),s.addEventListener("squeezeend",O),s.addEventListener("end",$),s.addEventListener("inputsourceschange",V),S.xrCompatible!==!0&&await t.makeXRCompatible(),_=e.getPixelRatio(),e.getSize(C),b&&"createProjectionLayer"in XRWebGLBinding.prototype){let le=null,Ne=null,Pe=null;S.depth&&(Pe=S.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,le=S.stencil?bi:Nn,Ne=S.stencil?As:Rn);let Ee={colorFormat:t.RGBA8,depthFormat:Pe,scaleFactor:r};u=this.getBinding(),d=u.createProjectionLayer(Ee),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new dn(d.textureWidth,d.textureHeight,{format:bn,type:an,depthTexture:new Qn(d.textureWidth,d.textureHeight,Ne,void 0,void 0,void 0,void 0,void 0,void 0,le),stencilBuffer:S.stencil,colorSpace:e.outputColorSpace,samples:S.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{let le={antialias:S.antialias,alpha:!0,depth:S.depth,stencil:S.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,le),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new dn(f.framebufferWidth,f.framebufferHeight,{format:bn,type:an,colorSpace:e.outputColorSpace,stencilBuffer:S.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),qe.setContext(s),qe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function V(ee){for(let ve=0;ve<ee.removed.length;ve++){let le=ee.removed[ve],Ne=R.indexOf(le);Ne>=0&&(R[Ne]=null,A[Ne].disconnect(le))}for(let ve=0;ve<ee.added.length;ve++){let le=ee.added[ve],Ne=R.indexOf(le);if(Ne===-1){for(let Ee=0;Ee<A.length;Ee++)if(Ee>=R.length){R.push(le),Ne=Ee;break}else if(R[Ee]===null){R[Ee]=le,Ne=Ee;break}if(Ne===-1)break}let Pe=A[Ne];Pe&&Pe.connect(le)}}let ie=new U,he=new U;function xe(ee,ve,le){ie.setFromMatrixPosition(ve.matrixWorld),he.setFromMatrixPosition(le.matrixWorld);let Ne=ie.distanceTo(he),Pe=ve.projectionMatrix.elements,Ee=le.projectionMatrix.elements,Ye=Pe[14]/(Pe[10]-1),Ue=Pe[14]/(Pe[10]+1),H=(Pe[9]+1)/Pe[5],K=(Pe[9]-1)/Pe[5],te=(Pe[8]-1)/Pe[0],ge=(Ee[8]+1)/Ee[0],de=Ye*te,We=Ye*ge,He=Ne/(-te+ge),je=He*-te;if(ve.matrixWorld.decompose(ee.position,ee.quaternion,ee.scale),ee.translateX(je),ee.translateZ(He),ee.matrixWorld.compose(ee.position,ee.quaternion,ee.scale),ee.matrixWorldInverse.copy(ee.matrixWorld).invert(),Pe[10]===-1)ee.projectionMatrix.copy(ve.projectionMatrix),ee.projectionMatrixInverse.copy(ve.projectionMatrixInverse);else{let L=Ye+He,T=Ue+He,j=de-je,ue=We+(Ne-je),M=H*Ue/T*L,g=K*Ue/T*L;ee.projectionMatrix.makePerspective(j,ue,M,g,L,T),ee.projectionMatrixInverse.copy(ee.projectionMatrix).invert()}}function ce(ee,ve){ve===null?ee.matrixWorld.copy(ee.matrix):ee.matrixWorld.multiplyMatrices(ve.matrixWorld,ee.matrix),ee.matrixWorldInverse.copy(ee.matrixWorld).invert()}this.updateCamera=function(ee){if(s===null)return;let ve=ee.near,le=ee.far;m.texture!==null&&(m.depthNear>0&&(ve=m.depthNear),m.depthFar>0&&(le=m.depthFar)),k.near=P.near=E.near=ve,k.far=P.far=E.far=le,(Y!==k.near||J!==k.far)&&(s.updateRenderState({depthNear:k.near,depthFar:k.far}),Y=k.near,J=k.far),k.layers.mask=ee.layers.mask|6,E.layers.mask=k.layers.mask&-5,P.layers.mask=k.layers.mask&-3;let Ne=ee.parent,Pe=k.cameras;ce(k,Ne);for(let Ee=0;Ee<Pe.length;Ee++)ce(Pe[Ee],Ne);Pe.length===2?xe(k,E,P):k.projectionMatrix.copy(E.projectionMatrix),pe(ee,k,Ne)};function pe(ee,ve,le){le===null?ee.matrix.copy(ve.matrixWorld):(ee.matrix.copy(le.matrixWorld),ee.matrix.invert(),ee.matrix.multiply(ve.matrixWorld)),ee.matrix.decompose(ee.position,ee.quaternion,ee.scale),ee.updateMatrixWorld(!0),ee.projectionMatrix.copy(ve.projectionMatrix),ee.projectionMatrixInverse.copy(ve.projectionMatrixInverse),ee.isPerspectiveCamera&&(ee.fov=Da*2*Math.atan(1/ee.projectionMatrix.elements[5]),ee.zoom=1)}this.getCamera=function(){return k},this.getFoveation=function(){if(!(d===null&&f===null))return l},this.setFoveation=function(ee){l=ee,d!==null&&(d.fixedFoveation=ee),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=ee)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(k)},this.getCameraTexture=function(ee){return p[ee]};let nt=null;function st(ee,ve){if(h=ve.getViewerPose(c||a),x=ve,h!==null){let le=h.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let Ne=!1;le.length!==k.cameras.length&&(k.cameras.length=0,Ne=!0);for(let Ue=0;Ue<le.length;Ue++){let H=le[Ue],K=null;if(f!==null)K=f.getViewport(H);else{let ge=u.getViewSubImage(d,H);K=ge.viewport,Ue===0&&(e.setRenderTargetTextures(y,ge.colorTexture,ge.depthStencilTexture),e.setRenderTarget(y))}let te=I[Ue];te===void 0&&(te=new Vt,te.layers.enable(Ue),te.viewport=new Rt,I[Ue]=te),te.matrix.fromArray(H.transform.matrix),te.matrix.decompose(te.position,te.quaternion,te.scale),te.projectionMatrix.fromArray(H.projectionMatrix),te.projectionMatrixInverse.copy(te.projectionMatrix).invert(),te.viewport.set(K.x,K.y,K.width,K.height),Ue===0&&(k.matrix.copy(te.matrix),k.matrix.decompose(k.position,k.quaternion,k.scale)),Ne===!0&&k.cameras.push(te)}let Pe=s.enabledFeatures;if(Pe&&Pe.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&b){u=n.getBinding();let Ue=u.getDepthInformation(le[0]);Ue&&Ue.isValid&&Ue.texture&&m.init(Ue,s.renderState)}if(Pe&&Pe.includes("camera-access")&&b){e.state.unbindTexture(),u=n.getBinding();for(let Ue=0;Ue<le.length;Ue++){let H=le[Ue].camera;if(H){let K=p[H];K||(K=new hr,p[H]=K);let te=u.getCameraImage(H);K.sourceTexture=te}}}}for(let le=0;le<A.length;le++){let Ne=R[le],Pe=A[le];Ne!==null&&Pe!==void 0&&Pe.update(Ne,ve,c||a)}nt&&nt(ee,ve),ve.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ve}),x=null}let qe=new pd;qe.setAnimationLoop(st),this.setAnimationLoop=function(ee){nt=ee},this.dispose=function(){}}},Yx=new Et,vd=new rt;vd.set(-1,0,0,0,1,0,0,0,1);function $x(i,e){function t(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function n(m,p){p.color.getRGB(m.fogColor.value,Tc(i)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function s(m,p,S,w,y){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?r(m,p):p.isMeshLambertMaterial?(r(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(r(m,p),u(m,p)):p.isMeshPhongMaterial?(r(m,p),h(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(r(m,p),d(m,p),p.isMeshPhysicalMaterial&&f(m,p,y)):p.isMeshMatcapMaterial?(r(m,p),x(m,p)):p.isMeshDepthMaterial?r(m,p):p.isMeshDistanceMaterial?(r(m,p),b(m,p)):p.isMeshNormalMaterial?r(m,p):p.isLineBasicMaterial?(a(m,p),p.isLineDashedMaterial&&o(m,p)):p.isPointsMaterial?l(m,p,S,w):p.isSpriteMaterial?c(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,t(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Zt&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,t(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Zt&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,t(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,t(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);let S=e.get(p),w=S.envMap,y=S.envMapRotation;w&&(m.envMap.value=w,m.envMapRotation.value.setFromMatrix4(Yx.makeRotationFromEuler(y)).transpose(),w.isCubeTexture&&w.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(vd),m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,m.aoMapTransform))}function a(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform))}function o(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function l(m,p,S,w){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*S,m.scale.value=w*.5,p.map&&(m.map.value=p.map,t(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function c(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function u(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function d(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,S){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Zt&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=S.texture,m.transmissionSamplerSize.value.set(S.width,S.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,m.specularIntensityMapTransform))}function x(m,p){p.matcap&&(m.matcap.value=p.matcap)}function b(m,p){let S=e.get(p).light;m.referencePosition.value.setFromMatrixPosition(S.matrixWorld),m.nearDistance.value=S.shadow.camera.near,m.farDistance.value=S.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Zx(i,e,t,n){let s={},r={},a=[],o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(y,A){let R=A.program;n.uniformBlockBinding(y,R)}function c(y,A){let R=s[y.id];R===void 0&&(m(y),R=h(y),s[y.id]=R,y.addEventListener("dispose",S));let C=A.program;n.updateUBOMapping(y,C);let _=e.render.frame;r[y.id]!==_&&(d(y),r[y.id]=_)}function h(y){let A=u();y.__bindingPointIndex=A;let R=i.createBuffer(),C=y.__size,_=y.usage;return i.bindBuffer(i.UNIFORM_BUFFER,R),i.bufferData(i.UNIFORM_BUFFER,C,_),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,A,R),R}function u(){for(let y=0;y<o;y++)if(a.indexOf(y)===-1)return a.push(y),y;return it("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(y){let A=s[y.id],R=y.uniforms,C=y.__cache;i.bindBuffer(i.UNIFORM_BUFFER,A);for(let _=0,E=R.length;_<E;_++){let P=R[_];if(Array.isArray(P))for(let I=0,k=P.length;I<k;I++)f(P[I],_,I,C);else f(P,_,0,C)}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(y,A,R,C){if(b(y,A,R,C)===!0){let _=y.__offset,E=y.value;if(Array.isArray(E)){let P=0;for(let I=0;I<E.length;I++){let k=E[I],Y=p(k);x(k,y.__data,P),typeof k!="number"&&typeof k!="boolean"&&!k.isMatrix3&&!ArrayBuffer.isView(k)&&(P+=Y.storage/Float32Array.BYTES_PER_ELEMENT)}}else x(E,y.__data,0);i.bufferSubData(i.UNIFORM_BUFFER,_,y.__data)}}function x(y,A,R){typeof y=="number"||typeof y=="boolean"?A[0]=y:y.isMatrix3?(A[0]=y.elements[0],A[1]=y.elements[1],A[2]=y.elements[2],A[3]=0,A[4]=y.elements[3],A[5]=y.elements[4],A[6]=y.elements[5],A[7]=0,A[8]=y.elements[6],A[9]=y.elements[7],A[10]=y.elements[8],A[11]=0):ArrayBuffer.isView(y)?A.set(new y.constructor(y.buffer,y.byteOffset,A.length)):y.toArray(A,R)}function b(y,A,R,C){let _=y.value,E=A+"_"+R;if(C[E]===void 0)return typeof _=="number"||typeof _=="boolean"?C[E]=_:ArrayBuffer.isView(_)?C[E]=_.slice():C[E]=_.clone(),!0;{let P=C[E];if(typeof _=="number"||typeof _=="boolean"){if(P!==_)return C[E]=_,!0}else{if(ArrayBuffer.isView(_))return!0;if(P.equals(_)===!1)return P.copy(_),!0}}return!1}function m(y){let A=y.uniforms,R=0,C=16;for(let E=0,P=A.length;E<P;E++){let I=Array.isArray(A[E])?A[E]:[A[E]];for(let k=0,Y=I.length;k<Y;k++){let J=I[k],O=Array.isArray(J.value)?J.value:[J.value];for(let $=0,V=O.length;$<V;$++){let ie=O[$],he=p(ie),xe=R%C,ce=xe%he.boundary,pe=xe+ce;R+=ce,pe!==0&&C-pe<he.storage&&(R+=C-pe),J.__data=new Float32Array(he.storage/Float32Array.BYTES_PER_ELEMENT),J.__offset=R,R+=he.storage}}}let _=R%C;return _>0&&(R+=C-_),y.__size=R,y.__cache={},this}function p(y){let A={boundary:0,storage:0};return typeof y=="number"||typeof y=="boolean"?(A.boundary=4,A.storage=4):y.isVector2?(A.boundary=8,A.storage=8):y.isVector3||y.isColor?(A.boundary=16,A.storage=12):y.isVector4?(A.boundary=16,A.storage=16):y.isMatrix3?(A.boundary=48,A.storage=48):y.isMatrix4?(A.boundary=64,A.storage=64):y.isTexture?tt("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(y)?(A.boundary=16,A.storage=y.byteLength):tt("WebGLRenderer: Unsupported uniform value type.",y),A}function S(y){let A=y.target;A.removeEventListener("dispose",S);let R=a.indexOf(A.__bindingPointIndex);a.splice(R,1),i.deleteBuffer(s[A.id]),delete s[A.id],delete r[A.id]}function w(){for(let y in s)i.deleteBuffer(s[y]);a=[],s={},r={}}return{bind:l,update:c,dispose:w}}var Jx=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Vn=null;function Kx(){return Vn===null&&(Vn=new or(Jx,16,16,Mi,kn),Vn.name="DFG_LUT",Vn.minFilter=Ht,Vn.magFilter=Ht,Vn.wrapS=Fn,Vn.wrapT=Fn,Vn.generateMipmaps=!1,Vn.needsUpdate=!0),Vn}var sl=class{constructor(e={}){let{canvas:t=Du(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=an}=e;this.isWebGLRenderer=!0;let x;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");x=n.getContextAttributes().alpha}else x=a;let b=f,m=new Set([vo,yo,_o]),p=new Set([an,Rn,Ts,As,mo,go]),S=new Uint32Array(4),w=new Int32Array(4),y=new U,A=null,R=null,C=[],_=[],E=null;this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=An,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let P=this,I=!1,k=null,Y=null,J=null,O=null;this._outputColorSpace=hn;let $=0,V=0,ie=null,he=-1,xe=null,ce=new Rt,pe=new Rt,nt=null,st=new dt(0),qe=0,ee=t.width,ve=t.height,le=1,Ne=null,Pe=null,Ee=new Rt(0,0,ee,ve),Ye=new Rt(0,0,ee,ve),Ue=!1,H=new _s,K=!1,te=!1,ge=new Et,de=new U,We=new Rt,He={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},je=!1;function L(){return ie===null?le:1}let T=n;function j(v,N){return t.getContext(v,N)}try{let v={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"185"}`),t.addEventListener("webglcontextlost",_t,!1),t.addEventListener("webglcontextrestored",yt,!1),t.addEventListener("webglcontextcreationerror",Jt,!1),T===null){let N="webgl2";if(T=j(N,v),T===null)throw j(N)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(v){throw it("WebGLRenderer: "+v.message),v}let ue,M,g,F,z,G,re,fe,Q,ne,be,ke,Ae,Me,Ge,Je,Ke,D,_e,se,Te,Ie,oe;function Ve(){ue=new s0(T),ue.init(),Te=new Wx(T,ue),M=new Jg(T,ue,e,Te),g=new Hx(T,ue),M.reversedDepthBuffer&&d&&g.buffers.depth.setReversed(!0),Y=T.createFramebuffer(),J=T.createFramebuffer(),O=T.createFramebuffer(),F=new o0(T),z=new Rx,G=new Gx(T,ue,g,z,M,Te,F),re=new i0(P),fe=new up(T),Ie=new $g(T,fe),Q=new r0(T,fe,F,Ie),ne=new c0(T,Q,fe,Ie,F),D=new l0(T,M,G),Ge=new Kg(z),be=new Ax(P,re,ue,M,Ie,Ge),ke=new $x(P,z),Ae=new Px,Me=new Ux(ue),Ke=new Yg(P,re,g,ne,x,l),Je=new Vx(P,ne,M),oe=new Zx(T,F,M,g),_e=new Zg(T,ue,F),se=new a0(T,ue,F),F.programs=be.programs,P.capabilities=M,P.extensions=ue,P.properties=z,P.renderLists=Ae,P.shadowMap=Je,P.state=g,P.info=F}Ve(),b!==an&&(E=new u0(b,t.width,t.height,o,s,r));let Be=new Wc(P,T);this.xr=Be,this.getContext=function(){return T},this.getContextAttributes=function(){return T.getContextAttributes()},this.forceContextLoss=function(){let v=ue.get("WEBGL_lose_context");v&&v.loseContext()},this.forceContextRestore=function(){let v=ue.get("WEBGL_lose_context");v&&v.restoreContext()},this.getPixelRatio=function(){return le},this.setPixelRatio=function(v){v!==void 0&&(le=v,this.setSize(ee,ve,!1))},this.getSize=function(v){return v.set(ee,ve)},this.setSize=function(v,N,Z=!0){if(Be.isPresenting){tt("WebGLRenderer: Can't change size while VR device is presenting.");return}ee=v,ve=N,t.width=Math.floor(v*le),t.height=Math.floor(N*le),Z===!0&&(t.style.width=v+"px",t.style.height=N+"px"),E!==null&&E.setSize(t.width,t.height),this.setViewport(0,0,v,N)},this.getDrawingBufferSize=function(v){return v.set(ee*le,ve*le).floor()},this.setDrawingBufferSize=function(v,N,Z){ee=v,ve=N,le=Z,t.width=Math.floor(v*Z),t.height=Math.floor(N*Z),this.setViewport(0,0,v,N)},this.setEffects=function(v){if(b===an){it("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(v){for(let N=0;N<v.length;N++)if(v[N].isOutputPass===!0){tt("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}E.setEffects(v||[])},this.getCurrentViewport=function(v){return v.copy(ce)},this.getViewport=function(v){return v.copy(Ee)},this.setViewport=function(v,N,Z,X){v.isVector4?Ee.set(v.x,v.y,v.z,v.w):Ee.set(v,N,Z,X),g.viewport(ce.copy(Ee).multiplyScalar(le).round())},this.getScissor=function(v){return v.copy(Ye)},this.setScissor=function(v,N,Z,X){v.isVector4?Ye.set(v.x,v.y,v.z,v.w):Ye.set(v,N,Z,X),g.scissor(pe.copy(Ye).multiplyScalar(le).round())},this.getScissorTest=function(){return Ue},this.setScissorTest=function(v){g.setScissorTest(Ue=v)},this.setOpaqueSort=function(v){Ne=v},this.setTransparentSort=function(v){Pe=v},this.getClearColor=function(v){return v.copy(Ke.getClearColor())},this.setClearColor=function(){Ke.setClearColor(...arguments)},this.getClearAlpha=function(){return Ke.getClearAlpha()},this.setClearAlpha=function(){Ke.setClearAlpha(...arguments)},this.clear=function(v=!0,N=!0,Z=!0){let X=0;if(v){let q=!1;if(ie!==null){let Re=ie.texture.format;q=m.has(Re)}if(q){let Re=ie.texture.type,De=p.has(Re),Se=Ke.getClearColor(),Xe=Ke.getClearAlpha(),$e=Se.r,ot=Se.g,ht=Se.b;De?(S[0]=$e,S[1]=ot,S[2]=ht,S[3]=Xe,T.clearBufferuiv(T.COLOR,0,S)):(w[0]=$e,w[1]=ot,w[2]=ht,w[3]=Xe,T.clearBufferiv(T.COLOR,0,w))}else X|=T.COLOR_BUFFER_BIT}N&&(X|=T.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),Z&&(X|=T.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),X!==0&&T.clear(X)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(v){v.setRenderer(this),k=v},this.dispose=function(){t.removeEventListener("webglcontextlost",_t,!1),t.removeEventListener("webglcontextrestored",yt,!1),t.removeEventListener("webglcontextcreationerror",Jt,!1),Ke.dispose(),Ae.dispose(),Me.dispose(),z.dispose(),re.dispose(),ne.dispose(),Ie.dispose(),oe.dispose(),be.dispose(),Be.dispose(),Be.removeEventListener("sessionstart",Fs),Be.removeEventListener("sessionend",Ns),jt.stop()};function _t(v){v.preventDefault(),wc("WebGLRenderer: Context Lost."),I=!0}function yt(){wc("WebGLRenderer: Context Restored."),I=!1;let v=F.autoReset,N=Je.enabled,Z=Je.autoUpdate,X=Je.needsUpdate,q=Je.type;Ve(),F.autoReset=v,Je.enabled=N,Je.autoUpdate=Z,Je.needsUpdate=X,Je.type=q}function Jt(v){it("WebGLRenderer: A WebGL context could not be created. Reason: ",v.statusMessage)}function Kt(v){let N=v.target;N.removeEventListener("dispose",Kt),Ls(N)}function Ls(v){Wi(v),z.remove(v)}function Wi(v){let N=z.get(v).programs;N!==void 0&&(N.forEach(function(Z){be.releaseProgram(Z)}),v.isShaderMaterial&&be.releaseShaderCache(v))}this.renderBufferDirect=function(v,N,Z,X,q,Re){N===null&&(N=He);let De=q.isMesh&&q.matrixWorld.determinantAffine()<0,Se=Fe(v,N,Z,X,q);g.setMaterial(X,De);let Xe=Z.index,$e=1;if(X.wireframe===!0){if(Xe=Q.getWireframeAttribute(Z),Xe===void 0)return;$e=2}let ot=Z.drawRange,ht=Z.attributes.position,Ze=ot.start*$e,Mt=(ot.start+ot.count)*$e;Re!==null&&(Ze=Math.max(Ze,Re.start*$e),Mt=Math.min(Mt,(Re.start+Re.count)*$e)),Xe!==null?(Ze=Math.max(Ze,0),Mt=Math.min(Mt,Xe.count)):ht!=null&&(Ze=Math.max(Ze,0),Mt=Math.min(Mt,ht.count));let Lt=Mt-Ze;if(Lt<0||Lt===1/0)return;Ie.setup(q,X,Se,Z,Xe);let Pt,St=_e;if(Xe!==null&&(Pt=fe.get(Xe),St=se,St.setIndex(Pt)),q.isMesh)X.wireframe===!0?(g.setLineWidth(X.wireframeLinewidth*L()),St.setMode(T.LINES)):St.setMode(T.TRIANGLES);else if(q.isLine){let Gt=X.linewidth;Gt===void 0&&(Gt=1),g.setLineWidth(Gt*L()),q.isLineSegments?St.setMode(T.LINES):q.isLineLoop?St.setMode(T.LINE_LOOP):St.setMode(T.LINE_STRIP)}else q.isPoints?St.setMode(T.POINTS):q.isSprite&&St.setMode(T.TRIANGLES);if(q.isBatchedMesh)if(ue.get("WEBGL_multi_draw"))St.renderMultiDraw(q._multiDrawStarts,q._multiDrawCounts,q._multiDrawCount);else{let Gt=q._multiDrawStarts,Oe=q._multiDrawCounts,on=q._multiDrawCount,xt=Xe?fe.get(Xe).bytesPerElement:1,gn=z.get(X).currentProgram.getUniforms();for(let Cn=0;Cn<on;Cn++)gn.setValue(T,"_gl_DrawID",Cn),St.render(Gt[Cn]/xt,Oe[Cn])}else if(q.isInstancedMesh)St.renderInstances(Ze,Lt,q.count);else if(Z.isInstancedBufferGeometry){let Gt=Z._maxInstanceCount!==void 0?Z._maxInstanceCount:1/0,Oe=Math.min(Z.instanceCount,Gt);St.renderInstances(Ze,Lt,Oe)}else St.render(Ze,Lt)};function Xi(v,N,Z){v.transparent===!0&&v.side===rn&&v.forceSinglePass===!1?(v.side=Zt,v.needsUpdate=!0,W(v,N,Z),v.side=Jn,v.needsUpdate=!0,W(v,N,Z),v.side=rn):W(v,N,Z)}this.compile=function(v,N,Z=null){Z===null&&(Z=v),R=Me.get(Z),R.init(N),_.push(R),Z.traverseVisible(function(q){q.isLight&&q.layers.test(N.layers)&&(R.pushLight(q),q.castShadow&&R.pushShadow(q))}),v!==Z&&v.traverseVisible(function(q){q.isLight&&q.layers.test(N.layers)&&(R.pushLight(q),q.castShadow&&R.pushShadow(q))}),R.setupLights();let X=new Set;return v.traverse(function(q){if(!(q.isMesh||q.isPoints||q.isLine||q.isSprite))return;let Re=q.material;if(Re)if(Array.isArray(Re))for(let De=0;De<Re.length;De++){let Se=Re[De];Xi(Se,Z,q),X.add(Se)}else Xi(Re,Z,q),X.add(Re)}),R=_.pop(),X},this.compileAsync=function(v,N,Z=null){let X=this.compile(v,N,Z);return new Promise(q=>{function Re(){if(X.forEach(function(De){z.get(De).currentProgram.isReady()&&X.delete(De)}),X.size===0){q(v);return}setTimeout(Re,10)}ue.get("KHR_parallel_shader_compile")!==null?Re():setTimeout(Re,10)})};let wi=null;function Hr(v){wi&&wi(v)}function Fs(){jt.stop()}function Ns(){jt.start()}let jt=new pd;jt.setAnimationLoop(Hr),typeof self<"u"&&jt.setContext(self),this.setAnimationLoop=function(v){wi=v,Be.setAnimationLoop(v),v===null?jt.stop():jt.start()},Be.addEventListener("sessionstart",Fs),Be.addEventListener("sessionend",Ns),this.render=function(v,N){if(N!==void 0&&N.isCamera!==!0){it("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(I===!0)return;k!==null&&k.renderStart(v,N);let Z=Be.enabled===!0&&Be.isPresenting===!0,X=E!==null&&(ie===null||Z)&&E.begin(P,ie);if(v.matrixWorldAutoUpdate===!0&&v.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),Be.enabled===!0&&Be.isPresenting===!0&&(E===null||E.isCompositing()===!1)&&(Be.cameraAutoUpdate===!0&&Be.updateCamera(N),N=Be.getCamera()),v.isScene===!0&&v.onBeforeRender(P,v,N,ie),R=Me.get(v,_.length),R.init(N),R.state.textureUnits=G.getTextureUnits(),_.push(R),ge.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),H.setFromProjectionMatrix(ge,Tn,N.reversedDepth),te=this.localClippingEnabled,K=Ge.init(this.clippingPlanes,te),A=Ae.get(v,C.length),A.init(),C.push(A),Be.enabled===!0&&Be.isPresenting===!0){let De=P.xr.getDepthSensingMesh();De!==null&&Ds(De,N,-1/0,P.sortObjects)}Ds(v,N,0,P.sortObjects),A.finish(),P.sortObjects===!0&&A.sort(Ne,Pe,N.reversedDepth),je=Be.enabled===!1||Be.isPresenting===!1||Be.hasDepthSensing()===!1,je&&Ke.addToRenderList(A,v),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),K===!0&&Ge.beginShadows();let q=R.state.shadowsArray;if(Je.render(q,v,N),K===!0&&Ge.endShadows(),(X&&E.hasRenderPass())===!1){let De=A.opaque,Se=A.transmissive;if(R.setupLights(),N.isArrayCamera){let Xe=N.cameras;if(Se.length>0)for(let $e=0,ot=Xe.length;$e<ot;$e++){let ht=Xe[$e];Wr(De,Se,v,ht)}je&&Ke.render(v);for(let $e=0,ot=Xe.length;$e<ot;$e++){let ht=Xe[$e];Gr(A,v,ht,ht.viewport)}}else Se.length>0&&Wr(De,Se,v,N),je&&Ke.render(v),Gr(A,v,N)}ie!==null&&V===0&&(G.updateMultisampleRenderTarget(ie),G.updateRenderTargetMipmap(ie)),X&&E.end(P),v.isScene===!0&&v.onAfterRender(P,v,N),Ie.resetDefaultState(),he=-1,xe=null,_.pop(),_.length>0?(R=_[_.length-1],G.setTextureUnits(R.state.textureUnits),K===!0&&Ge.setGlobalState(P.clippingPlanes,R.state.camera)):R=null,C.pop(),C.length>0?A=C[C.length-1]:A=null,k!==null&&k.renderEnd()};function Ds(v,N,Z,X){if(v.visible===!1)return;if(v.layers.test(N.layers)){if(v.isGroup)Z=v.renderOrder;else if(v.isLOD)v.autoUpdate===!0&&v.update(N);else if(v.isLightProbeGrid)R.pushLightProbeGrid(v);else if(v.isLight)R.pushLight(v),v.castShadow&&R.pushShadow(v);else if(v.isSprite){if(!v.frustumCulled||H.intersectsSprite(v)){X&&We.setFromMatrixPosition(v.matrixWorld).applyMatrix4(ge);let De=ne.update(v),Se=v.material;Se.visible&&A.push(v,De,Se,Z,We.z,null)}}else if((v.isMesh||v.isLine||v.isPoints)&&(!v.frustumCulled||H.intersectsObject(v))){let De=ne.update(v),Se=v.material;if(X&&(v.boundingSphere!==void 0?(v.boundingSphere===null&&v.computeBoundingSphere(),We.copy(v.boundingSphere.center)):(De.boundingSphere===null&&De.computeBoundingSphere(),We.copy(De.boundingSphere.center)),We.applyMatrix4(v.matrixWorld).applyMatrix4(ge)),Array.isArray(Se)){let Xe=De.groups;for(let $e=0,ot=Xe.length;$e<ot;$e++){let ht=Xe[$e],Ze=Se[ht.materialIndex];Ze&&Ze.visible&&A.push(v,De,Ze,Z,We.z,ht)}}else Se.visible&&A.push(v,De,Se,Z,We.z,null)}}let Re=v.children;for(let De=0,Se=Re.length;De<Se;De++)Ds(Re[De],N,Z,X)}function Gr(v,N,Z,X){let{opaque:q,transmissive:Re,transparent:De}=v;R.setupLightsView(Z),K===!0&&Ge.setGlobalState(P.clippingPlanes,Z),X&&g.viewport(ce.copy(X)),q.length>0&&Ei(q,N,Z),Re.length>0&&Ei(Re,N,Z),De.length>0&&Ei(De,N,Z),g.buffers.depth.setTest(!0),g.buffers.depth.setMask(!0),g.buffers.color.setMask(!0),g.setPolygonOffset(!1)}function Wr(v,N,Z,X){if((Z.isScene===!0?Z.overrideMaterial:null)!==null)return;if(R.state.transmissionRenderTarget[X.id]===void 0){let Ze=ue.has("EXT_color_buffer_half_float")||ue.has("EXT_color_buffer_float");R.state.transmissionRenderTarget[X.id]=new dn(1,1,{generateMipmaps:!0,type:Ze?kn:an,minFilter:vi,samples:Math.max(4,M.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:mt.workingColorSpace})}let Re=R.state.transmissionRenderTarget[X.id],De=X.viewport||ce;Re.setSize(De.z*P.transmissionResolutionScale,De.w*P.transmissionResolutionScale);let Se=P.getRenderTarget(),Xe=P.getActiveCubeFace(),$e=P.getActiveMipmapLevel();P.setRenderTarget(Re),P.getClearColor(st),qe=P.getClearAlpha(),qe<1&&P.setClearColor(16777215,.5),P.clear(),je&&Ke.render(Z);let ot=P.toneMapping;P.toneMapping=An;let ht=X.viewport;if(X.viewport!==void 0&&(X.viewport=void 0),R.setupLightsView(X),K===!0&&Ge.setGlobalState(P.clippingPlanes,X),Ei(v,Z,X),G.updateMultisampleRenderTarget(Re),G.updateRenderTargetMipmap(Re),ue.has("WEBGL_multisampled_render_to_texture")===!1){let Ze=!1;for(let Mt=0,Lt=N.length;Mt<Lt;Mt++){let Pt=N[Mt],{object:St,geometry:Gt,material:Oe,group:on}=Pt;if(Oe.side===rn&&St.layers.test(X.layers)){let xt=Oe.side;Oe.side=Zt,Oe.needsUpdate=!0,B(St,Z,X,Gt,Oe,on),Oe.side=xt,Oe.needsUpdate=!0,Ze=!0}}Ze===!0&&(G.updateMultisampleRenderTarget(Re),G.updateRenderTargetMipmap(Re))}P.setRenderTarget(Se,Xe,$e),P.setClearColor(st,qe),ht!==void 0&&(X.viewport=ht),P.toneMapping=ot}function Ei(v,N,Z){let X=N.isScene===!0?N.overrideMaterial:null;for(let q=0,Re=v.length;q<Re;q++){let De=v[q],{object:Se,geometry:Xe,group:$e}=De,ot=De.material;ot.allowOverride===!0&&X!==null&&(ot=X),Se.layers.test(Z.layers)&&B(Se,N,Z,Xe,ot,$e)}}function B(v,N,Z,X,q,Re){v.onBeforeRender(P,N,Z,X,q,Re),v.modelViewMatrix.multiplyMatrices(Z.matrixWorldInverse,v.matrixWorld),v.normalMatrix.getNormalMatrix(v.modelViewMatrix),q.onBeforeRender(P,N,Z,X,v,Re),q.transparent===!0&&q.side===rn&&q.forceSinglePass===!1?(q.side=Zt,q.needsUpdate=!0,P.renderBufferDirect(Z,N,X,q,v,Re),q.side=Jn,q.needsUpdate=!0,P.renderBufferDirect(Z,N,X,q,v,Re),q.side=rn):P.renderBufferDirect(Z,N,X,q,v,Re),v.onAfterRender(P,N,Z,X,q,Re)}function W(v,N,Z){N.isScene!==!0&&(N=He);let X=z.get(v),q=R.state.lights,Re=R.state.shadowsArray,De=q.state.version,Se=be.getParameters(v,q.state,Re,N,Z,R.state.lightProbeGridArray),Xe=be.getProgramCacheKey(Se),$e=X.programs;X.environment=v.isMeshStandardMaterial||v.isMeshLambertMaterial||v.isMeshPhongMaterial?N.environment:null,X.fog=N.fog;let ot=v.isMeshStandardMaterial||v.isMeshLambertMaterial&&!v.envMap||v.isMeshPhongMaterial&&!v.envMap;X.envMap=re.get(v.envMap||X.environment,ot),X.envMapRotation=X.environment!==null&&v.envMap===null?N.environmentRotation:v.envMapRotation,$e===void 0&&(v.addEventListener("dispose",Kt),$e=new Map,X.programs=$e);let ht=$e.get(Xe);if(ht!==void 0){if(X.currentProgram===ht&&X.lightsStateVersion===De)return me(v,Se),ht}else Se.uniforms=be.getUniforms(v),k!==null&&v.isNodeMaterial&&k.build(v,Z,Se),v.onBeforeCompile(Se,P),ht=be.acquireProgram(Se,Xe),$e.set(Xe,ht),X.uniforms=Se.uniforms;let Ze=X.uniforms;return(!v.isShaderMaterial&&!v.isRawShaderMaterial||v.clipping===!0)&&(Ze.clippingPlanes=Ge.uniform),me(v,Se),X.needsLights=ye(v),X.lightsStateVersion=De,X.needsLights&&(Ze.ambientLightColor.value=q.state.ambient,Ze.lightProbe.value=q.state.probe,Ze.directionalLights.value=q.state.directional,Ze.directionalLightShadows.value=q.state.directionalShadow,Ze.spotLights.value=q.state.spot,Ze.spotLightShadows.value=q.state.spotShadow,Ze.rectAreaLights.value=q.state.rectArea,Ze.ltc_1.value=q.state.rectAreaLTC1,Ze.ltc_2.value=q.state.rectAreaLTC2,Ze.pointLights.value=q.state.point,Ze.pointLightShadows.value=q.state.pointShadow,Ze.hemisphereLights.value=q.state.hemi,Ze.directionalShadowMatrix.value=q.state.directionalShadowMatrix,Ze.spotLightMatrix.value=q.state.spotLightMatrix,Ze.spotLightMap.value=q.state.spotLightMap,Ze.pointShadowMatrix.value=q.state.pointShadowMatrix),X.lightProbeGrid=R.state.lightProbeGridArray.length>0,X.currentProgram=ht,X.uniformsList=null,ht}function ae(v){if(v.uniformsList===null){let N=v.currentProgram.getUniforms();v.uniformsList=Ps.seqWithValue(N.seq,v.uniforms)}return v.uniformsList}function me(v,N){let Z=z.get(v);Z.outputColorSpace=N.outputColorSpace,Z.batching=N.batching,Z.batchingColor=N.batchingColor,Z.instancing=N.instancing,Z.instancingColor=N.instancingColor,Z.instancingMorph=N.instancingMorph,Z.skinning=N.skinning,Z.morphTargets=N.morphTargets,Z.morphNormals=N.morphNormals,Z.morphColors=N.morphColors,Z.morphTargetsCount=N.morphTargetsCount,Z.numClippingPlanes=N.numClippingPlanes,Z.numIntersection=N.numClipIntersection,Z.vertexAlphas=N.vertexAlphas,Z.vertexTangents=N.vertexTangents,Z.toneMapping=N.toneMapping}function Le(v,N){if(v.length===0)return null;if(v.length===1)return v[0].texture!==null?v[0]:null;y.setFromMatrixPosition(N.matrixWorld);for(let Z=0,X=v.length;Z<X;Z++){let q=v[Z];if(q.texture!==null&&q.boundingBox.containsPoint(y))return q}return null}function Fe(v,N,Z,X,q){N.isScene!==!0&&(N=He),G.resetTextureUnits();let Re=N.fog,De=X.isMeshStandardMaterial||X.isMeshLambertMaterial||X.isMeshPhongMaterial?N.environment:null,Se=ie===null?P.outputColorSpace:ie.isXRRenderTarget===!0?ie.texture.colorSpace:mt.workingColorSpace,Xe=X.isMeshStandardMaterial||X.isMeshLambertMaterial&&!X.envMap||X.isMeshPhongMaterial&&!X.envMap,$e=re.get(X.envMap||De,Xe),ot=X.vertexColors===!0&&!!Z.attributes.color&&Z.attributes.color.itemSize===4,ht=!!Z.attributes.tangent&&(!!X.normalMap||X.anisotropy>0),Ze=!!Z.morphAttributes.position,Mt=!!Z.morphAttributes.normal,Lt=!!Z.morphAttributes.color,Pt=An;X.toneMapped&&(ie===null||ie.isXRRenderTarget===!0)&&(Pt=P.toneMapping);let St=Z.morphAttributes.position||Z.morphAttributes.normal||Z.morphAttributes.color,Gt=St!==void 0?St.length:0,Oe=z.get(X),on=R.state.lights;if(K===!0&&(te===!0||v!==xe)){let Tt=v===xe&&X.id===he;Ge.setState(X,v,Tt)}let xt=!1;X.version===Oe.__version?(Oe.needsLights&&Oe.lightsStateVersion!==on.state.version||Oe.outputColorSpace!==Se||q.isBatchedMesh&&Oe.batching===!1||!q.isBatchedMesh&&Oe.batching===!0||q.isBatchedMesh&&Oe.batchingColor===!0&&q.colorTexture===null||q.isBatchedMesh&&Oe.batchingColor===!1&&q.colorTexture!==null||q.isInstancedMesh&&Oe.instancing===!1||!q.isInstancedMesh&&Oe.instancing===!0||q.isSkinnedMesh&&Oe.skinning===!1||!q.isSkinnedMesh&&Oe.skinning===!0||q.isInstancedMesh&&Oe.instancingColor===!0&&q.instanceColor===null||q.isInstancedMesh&&Oe.instancingColor===!1&&q.instanceColor!==null||q.isInstancedMesh&&Oe.instancingMorph===!0&&q.morphTexture===null||q.isInstancedMesh&&Oe.instancingMorph===!1&&q.morphTexture!==null||Oe.envMap!==$e||X.fog===!0&&Oe.fog!==Re||Oe.numClippingPlanes!==void 0&&(Oe.numClippingPlanes!==Ge.numPlanes||Oe.numIntersection!==Ge.numIntersection)||Oe.vertexAlphas!==ot||Oe.vertexTangents!==ht||Oe.morphTargets!==Ze||Oe.morphNormals!==Mt||Oe.morphColors!==Lt||Oe.toneMapping!==Pt||Oe.morphTargetsCount!==Gt||!!Oe.lightProbeGrid!=R.state.lightProbeGridArray.length>0)&&(xt=!0):(xt=!0,Oe.__version=X.version);let gn=Oe.currentProgram;xt===!0&&(gn=W(X,N,q),k&&X.isNodeMaterial&&k.onUpdateProgram(X,gn,Oe));let Cn=!1,ti=!1,qi=!1,wt=gn.getUniforms(),Ft=Oe.uniforms;if(g.useProgram(gn.program)&&(Cn=!0,ti=!0,qi=!0),X.id!==he&&(he=X.id,ti=!0),Oe.needsLights){let Tt=Le(R.state.lightProbeGridArray,q);Oe.lightProbeGrid!==Tt&&(Oe.lightProbeGrid=Tt,ti=!0)}if(Cn||xe!==v){g.buffers.depth.getReversed()&&v.reversedDepth!==!0&&(v._reversedDepth=!0,v.updateProjectionMatrix()),wt.setValue(T,"projectionMatrix",v.projectionMatrix),wt.setValue(T,"viewMatrix",v.matrixWorldInverse);let ii=wt.map.cameraPosition;ii!==void 0&&ii.setValue(T,de.setFromMatrixPosition(v.matrixWorld)),M.logarithmicDepthBuffer&&wt.setValue(T,"logDepthBufFC",2/(Math.log(v.far+1)/Math.LN2)),(X.isMeshPhongMaterial||X.isMeshToonMaterial||X.isMeshLambertMaterial||X.isMeshBasicMaterial||X.isMeshStandardMaterial||X.isShaderMaterial)&&wt.setValue(T,"isOrthographic",v.isOrthographicCamera===!0),xe!==v&&(xe=v,ti=!0,qi=!0)}if(Oe.needsLights&&(on.state.directionalShadowMap.length>0&&wt.setValue(T,"directionalShadowMap",on.state.directionalShadowMap,G),on.state.spotShadowMap.length>0&&wt.setValue(T,"spotShadowMap",on.state.spotShadowMap,G),on.state.pointShadowMap.length>0&&wt.setValue(T,"pointShadowMap",on.state.pointShadowMap,G)),q.isSkinnedMesh){wt.setOptional(T,q,"bindMatrix"),wt.setOptional(T,q,"bindMatrixInverse");let Tt=q.skeleton;Tt&&(Tt.boneTexture===null&&Tt.computeBoneTexture(),wt.setValue(T,"boneTexture",Tt.boneTexture,G))}q.isBatchedMesh&&(wt.setOptional(T,q,"batchingTexture"),wt.setValue(T,"batchingTexture",q._matricesTexture,G),wt.setOptional(T,q,"batchingIdTexture"),wt.setValue(T,"batchingIdTexture",q._indirectTexture,G),wt.setOptional(T,q,"batchingColorTexture"),q._colorsTexture!==null&&wt.setValue(T,"batchingColorTexture",q._colorsTexture,G));let ni=Z.morphAttributes;if((ni.position!==void 0||ni.normal!==void 0||ni.color!==void 0)&&D.update(q,Z,gn),(ti||Oe.receiveShadow!==q.receiveShadow)&&(Oe.receiveShadow=q.receiveShadow,wt.setValue(T,"receiveShadow",q.receiveShadow)),(X.isMeshStandardMaterial||X.isMeshLambertMaterial||X.isMeshPhongMaterial)&&X.envMap===null&&N.environment!==null&&(Ft.envMapIntensity.value=N.environmentIntensity),Ft.dfgLUT!==void 0&&(Ft.dfgLUT.value=Kx()),ti){if(wt.setValue(T,"toneMappingExposure",P.toneMappingExposure),Oe.needsLights&&ze(Ft,qi),Re&&X.fog===!0&&ke.refreshFogUniforms(Ft,Re),ke.refreshMaterialUniforms(Ft,X,le,ve,R.state.transmissionRenderTarget[v.id]),Oe.needsLights&&Oe.lightProbeGrid){let Tt=Oe.lightProbeGrid;Ft.probesSH.value=Tt.texture,Ft.probesMin.value.copy(Tt.boundingBox.min),Ft.probesMax.value.copy(Tt.boundingBox.max),Ft.probesResolution.value.copy(Tt.resolution)}Ps.upload(T,ae(Oe),Ft,G)}if(X.isShaderMaterial&&X.uniformsNeedUpdate===!0&&(Ps.upload(T,ae(Oe),Ft,G),X.uniformsNeedUpdate=!1),X.isSpriteMaterial&&wt.setValue(T,"center",q.center),wt.setValue(T,"modelViewMatrix",q.modelViewMatrix),wt.setValue(T,"normalMatrix",q.normalMatrix),wt.setValue(T,"modelMatrix",q.matrixWorld),X.uniformsGroups!==void 0){let Tt=X.uniformsGroups;for(let ii=0,Yi=Tt.length;ii<Yi;ii++){let Yc=Tt[ii];oe.update(Yc,gn),oe.bind(Yc,gn)}}return gn}function ze(v,N){v.ambientLightColor.needsUpdate=N,v.lightProbe.needsUpdate=N,v.directionalLights.needsUpdate=N,v.directionalLightShadows.needsUpdate=N,v.pointLights.needsUpdate=N,v.pointLightShadows.needsUpdate=N,v.spotLights.needsUpdate=N,v.spotLightShadows.needsUpdate=N,v.rectAreaLights.needsUpdate=N,v.hemisphereLights.needsUpdate=N}function ye(v){return v.isMeshLambertMaterial||v.isMeshToonMaterial||v.isMeshPhongMaterial||v.isMeshStandardMaterial||v.isShadowMaterial||v.isShaderMaterial&&v.lights===!0}this.getActiveCubeFace=function(){return $},this.getActiveMipmapLevel=function(){return V},this.getRenderTarget=function(){return ie},this.setRenderTargetTextures=function(v,N,Z){let X=z.get(v);X.__autoAllocateDepthBuffer=v.resolveDepthBuffer===!1,X.__autoAllocateDepthBuffer===!1&&(X.__useRenderToTexture=!1),z.get(v.texture).__webglTexture=N,z.get(v.depthTexture).__webglTexture=X.__autoAllocateDepthBuffer?void 0:Z,X.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(v,N){let Z=z.get(v);Z.__webglFramebuffer=N,Z.__useDefaultFramebuffer=N===void 0},this.setRenderTarget=function(v,N=0,Z=0){ie=v,$=N,V=Z;let X=null,q=!1,Re=!1;if(v){let Se=z.get(v);if(Se.__useDefaultFramebuffer!==void 0){g.bindFramebuffer(T.FRAMEBUFFER,Se.__webglFramebuffer),ce.copy(v.viewport),pe.copy(v.scissor),nt=v.scissorTest,g.viewport(ce),g.scissor(pe),g.setScissorTest(nt),he=-1;return}else if(Se.__webglFramebuffer===void 0)G.setupRenderTarget(v);else if(Se.__hasExternalTextures)G.rebindTextures(v,z.get(v.texture).__webglTexture,z.get(v.depthTexture).__webglTexture);else if(v.depthBuffer){let ot=v.depthTexture;if(Se.__boundDepthTexture!==ot){if(ot!==null&&z.has(ot)&&(v.width!==ot.image.width||v.height!==ot.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");G.setupDepthRenderbuffer(v)}}let Xe=v.texture;(Xe.isData3DTexture||Xe.isDataArrayTexture||Xe.isCompressedArrayTexture)&&(Re=!0);let $e=z.get(v).__webglFramebuffer;v.isWebGLCubeRenderTarget?(Array.isArray($e[N])?X=$e[N][Z]:X=$e[N],q=!0):v.samples>0&&G.useMultisampledRTT(v)===!1?X=z.get(v).__webglMultisampledFramebuffer:Array.isArray($e)?X=$e[Z]:X=$e,ce.copy(v.viewport),pe.copy(v.scissor),nt=v.scissorTest}else ce.copy(Ee).multiplyScalar(le).floor(),pe.copy(Ye).multiplyScalar(le).floor(),nt=Ue;if(Z!==0&&(X=Y),g.bindFramebuffer(T.FRAMEBUFFER,X)&&g.drawBuffers(v,X),g.viewport(ce),g.scissor(pe),g.setScissorTest(nt),q){let Se=z.get(v.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_CUBE_MAP_POSITIVE_X+N,Se.__webglTexture,Z)}else if(Re){let Se=N;for(let Xe=0;Xe<v.textures.length;Xe++){let $e=z.get(v.textures[Xe]);T.framebufferTextureLayer(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0+Xe,$e.__webglTexture,Z,Se)}}else if(v!==null&&Z!==0){let Se=z.get(v.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,Se.__webglTexture,Z)}he=-1},this.readRenderTargetPixels=function(v,N,Z,X,q,Re,De,Se=0){if(!(v&&v.isWebGLRenderTarget)){it("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Xe=z.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&De!==void 0&&(Xe=Xe[De]),Xe){g.bindFramebuffer(T.FRAMEBUFFER,Xe);try{let $e=v.textures[Se],ot=$e.format,ht=$e.type;if(v.textures.length>1&&T.readBuffer(T.COLOR_ATTACHMENT0+Se),!M.textureFormatReadable(ot)){it("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!M.textureTypeReadable(ht)){it("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=v.width-X&&Z>=0&&Z<=v.height-q&&T.readPixels(N,Z,X,q,Te.convert(ot),Te.convert(ht),Re)}finally{let $e=ie!==null?z.get(ie).__webglFramebuffer:null;g.bindFramebuffer(T.FRAMEBUFFER,$e)}}},this.readRenderTargetPixelsAsync=async function(v,N,Z,X,q,Re,De,Se=0){if(!(v&&v.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Xe=z.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&De!==void 0&&(Xe=Xe[De]),Xe)if(N>=0&&N<=v.width-X&&Z>=0&&Z<=v.height-q){g.bindFramebuffer(T.FRAMEBUFFER,Xe);let $e=v.textures[Se],ot=$e.format,ht=$e.type;if(v.textures.length>1&&T.readBuffer(T.COLOR_ATTACHMENT0+Se),!M.textureFormatReadable(ot))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!M.textureTypeReadable(ht))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ze=T.createBuffer();T.bindBuffer(T.PIXEL_PACK_BUFFER,Ze),T.bufferData(T.PIXEL_PACK_BUFFER,Re.byteLength,T.STREAM_READ),T.readPixels(N,Z,X,q,Te.convert(ot),Te.convert(ht),0);let Mt=ie!==null?z.get(ie).__webglFramebuffer:null;g.bindFramebuffer(T.FRAMEBUFFER,Mt);let Lt=T.fenceSync(T.SYNC_GPU_COMMANDS_COMPLETE,0);return T.flush(),await Ou(T,Lt,4),T.bindBuffer(T.PIXEL_PACK_BUFFER,Ze),T.getBufferSubData(T.PIXEL_PACK_BUFFER,0,Re),T.deleteBuffer(Ze),T.deleteSync(Lt),Re}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(v,N=null,Z=0){let X=Math.pow(2,-Z),q=Math.floor(v.image.width*X),Re=Math.floor(v.image.height*X),De=N!==null?N.x:0,Se=N!==null?N.y:0;G.setTexture2D(v,0),T.copyTexSubImage2D(T.TEXTURE_2D,Z,0,0,De,Se,q,Re),g.unbindTexture()},this.copyTextureToTexture=function(v,N,Z=null,X=null,q=0,Re=0){let De,Se,Xe,$e,ot,ht,Ze,Mt,Lt,Pt=v.isCompressedTexture?v.mipmaps[Re]:v.image;if(Z!==null)De=Z.max.x-Z.min.x,Se=Z.max.y-Z.min.y,Xe=Z.isBox3?Z.max.z-Z.min.z:1,$e=Z.min.x,ot=Z.min.y,ht=Z.isBox3?Z.min.z:0;else{let Ft=Math.pow(2,-q);De=Math.floor(Pt.width*Ft),Se=Math.floor(Pt.height*Ft),v.isDataArrayTexture?Xe=Pt.depth:v.isData3DTexture?Xe=Math.floor(Pt.depth*Ft):Xe=1,$e=0,ot=0,ht=0}X!==null?(Ze=X.x,Mt=X.y,Lt=X.z):(Ze=0,Mt=0,Lt=0);let St=Te.convert(N.format),Gt=Te.convert(N.type),Oe;N.isData3DTexture?(G.setTexture3D(N,0),Oe=T.TEXTURE_3D):N.isDataArrayTexture||N.isCompressedArrayTexture?(G.setTexture2DArray(N,0),Oe=T.TEXTURE_2D_ARRAY):(G.setTexture2D(N,0),Oe=T.TEXTURE_2D),g.activeTexture(T.TEXTURE0),g.pixelStorei(T.UNPACK_FLIP_Y_WEBGL,N.flipY),g.pixelStorei(T.UNPACK_PREMULTIPLY_ALPHA_WEBGL,N.premultiplyAlpha),g.pixelStorei(T.UNPACK_ALIGNMENT,N.unpackAlignment);let on=g.getParameter(T.UNPACK_ROW_LENGTH),xt=g.getParameter(T.UNPACK_IMAGE_HEIGHT),gn=g.getParameter(T.UNPACK_SKIP_PIXELS),Cn=g.getParameter(T.UNPACK_SKIP_ROWS),ti=g.getParameter(T.UNPACK_SKIP_IMAGES);g.pixelStorei(T.UNPACK_ROW_LENGTH,Pt.width),g.pixelStorei(T.UNPACK_IMAGE_HEIGHT,Pt.height),g.pixelStorei(T.UNPACK_SKIP_PIXELS,$e),g.pixelStorei(T.UNPACK_SKIP_ROWS,ot),g.pixelStorei(T.UNPACK_SKIP_IMAGES,ht);let qi=v.isDataArrayTexture||v.isData3DTexture,wt=N.isDataArrayTexture||N.isData3DTexture;if(v.isDepthTexture){let Ft=z.get(v),ni=z.get(N),Tt=z.get(Ft.__renderTarget),ii=z.get(ni.__renderTarget);g.bindFramebuffer(T.READ_FRAMEBUFFER,Tt.__webglFramebuffer),g.bindFramebuffer(T.DRAW_FRAMEBUFFER,ii.__webglFramebuffer);for(let Yi=0;Yi<Xe;Yi++)qi&&(T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,z.get(v).__webglTexture,q,ht+Yi),T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,z.get(N).__webglTexture,Re,Lt+Yi)),T.blitFramebuffer($e,ot,De,Se,Ze,Mt,De,Se,T.DEPTH_BUFFER_BIT,T.NEAREST);g.bindFramebuffer(T.READ_FRAMEBUFFER,null),g.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else if(q!==0||v.isRenderTargetTexture||z.has(v)){let Ft=z.get(v),ni=z.get(N);g.bindFramebuffer(T.READ_FRAMEBUFFER,J),g.bindFramebuffer(T.DRAW_FRAMEBUFFER,O);for(let Tt=0;Tt<Xe;Tt++)qi?T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,Ft.__webglTexture,q,ht+Tt):T.framebufferTexture2D(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,Ft.__webglTexture,q),wt?T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,ni.__webglTexture,Re,Lt+Tt):T.framebufferTexture2D(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,ni.__webglTexture,Re),q!==0?T.blitFramebuffer($e,ot,De,Se,Ze,Mt,De,Se,T.COLOR_BUFFER_BIT,T.NEAREST):wt?T.copyTexSubImage3D(Oe,Re,Ze,Mt,Lt+Tt,$e,ot,De,Se):T.copyTexSubImage2D(Oe,Re,Ze,Mt,$e,ot,De,Se);g.bindFramebuffer(T.READ_FRAMEBUFFER,null),g.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else wt?v.isDataTexture||v.isData3DTexture?T.texSubImage3D(Oe,Re,Ze,Mt,Lt,De,Se,Xe,St,Gt,Pt.data):N.isCompressedArrayTexture?T.compressedTexSubImage3D(Oe,Re,Ze,Mt,Lt,De,Se,Xe,St,Pt.data):T.texSubImage3D(Oe,Re,Ze,Mt,Lt,De,Se,Xe,St,Gt,Pt):v.isDataTexture?T.texSubImage2D(T.TEXTURE_2D,Re,Ze,Mt,De,Se,St,Gt,Pt.data):v.isCompressedTexture?T.compressedTexSubImage2D(T.TEXTURE_2D,Re,Ze,Mt,Pt.width,Pt.height,St,Pt.data):T.texSubImage2D(T.TEXTURE_2D,Re,Ze,Mt,De,Se,St,Gt,Pt);g.pixelStorei(T.UNPACK_ROW_LENGTH,on),g.pixelStorei(T.UNPACK_IMAGE_HEIGHT,xt),g.pixelStorei(T.UNPACK_SKIP_PIXELS,gn),g.pixelStorei(T.UNPACK_SKIP_ROWS,Cn),g.pixelStorei(T.UNPACK_SKIP_IMAGES,ti),Re===0&&N.generateMipmaps&&T.generateMipmap(Oe),g.unbindTexture()},this.initRenderTarget=function(v){z.get(v).__webglFramebuffer===void 0&&G.setupRenderTarget(v)},this.initTexture=function(v){v.isCubeTexture?G.setTextureCube(v,0):v.isData3DTexture?G.setTexture3D(v,0):v.isDataArrayTexture||v.isCompressedArrayTexture?G.setTexture2DArray(v,0):G.setTexture2D(v,0),g.unbindTexture()},this.resetState=function(){$=0,V=0,ie=null,g.reset(),Ie.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Tn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=mt._getDrawingBufferColorSpace(e),t.unpackColorSpace=mt._getUnpackColorSpace()}};function Qx(i){let e=i.later??((s,r)=>{setTimeout(s,r)}),t=i.stepMs??10,n=i.maxTries??500;return new Promise(s=>{let r=0,a=()=>{if(i.stopped()){s();return}r+=1;let o;try{o=i.ready()}catch{o=!0}if(o||r>=n){s();return}e(a,t)};a()})}function bd(i){let e;try{e=new Set(i.compile())}catch{return Promise.resolve()}return Qx({stopped:()=>i.stopped(),ready:()=>{for(let t of e)i.isReady(t)&&e.delete(t);return e.size===0},...i.later?{later:i.later}:{}})}var Sd={pixelRatioCap:2,shadows:!0,eyePass:!0,antialias:!0},wd=Math.PI/180,gt=at.colors,Md={over:{big:1.45,fig:1.9},mill:{big:1.1,fig:1.3},poster:{big:1.1,fig:1.3}},kr=(i,e,t)=>i+(e-i)*t,e_=(i,e,t)=>{let n=e-i;for(;n>Math.PI;)n-=2*Math.PI;for(;n<-Math.PI;)n+=2*Math.PI;return i+n*t},qc=(i,e,t)=>new U(i,e,t),Ed=(i,e)=>qc(Math.sin(i)*Math.cos(e),Math.sin(e),Math.cos(i)*Math.cos(e));function Xc(i,e,t,n){let s=e.fov*wd,r=Math.tan(s/2),a=r*t,o=Ed(e.az,e.el),l=new U().crossVectors(qc(0,1,0),o).normalize(),c=new U().crossVectors(o,l).normalize(),h=qc(0,0,0);for(let S of i)h.x+=S[0]/i.length,h.y+=S[1]/i.length,h.z+=S[2]/i.length;let u=(n[1]-n[0])/2,d=(n[3]-n[2])/2,f=(n[0]+n[1])/2,x=(n[2]+n[3])/2,b=new U,m=S=>{let w=h.clone().addScaledVector(o,S),y=99,A=-99,R=99,C=-99;for(let _ of i){b.set(_[0],_[1],_[2]).sub(w);let E=-b.dot(o),P=b.dot(l)/(E*a),I=b.dot(c)/(E*r);y=Math.min(y,P),A=Math.max(A,P),R=Math.min(R,I),C=Math.max(C,I)}return[y,A,R,C]},p=100;for(let S=0;S<4;S++){let w=5,y=4e3;for(let R=0;R<40;R++){let C=(w+y)/2,_=m(C);(_[1]-_[0])/2<=u&&(_[3]-_[2])/2<=d?y=C:w=C}p=y;let A=m(p);h.addScaledVector(l,((A[0]+A[1])/2-f)*p*a).addScaledVector(c,((A[2]+A[3])/2-x)*p*r)}return{az:e.az,el:e.el,d:p,fov:e.fov,target:h}}function Td(i,e,t,n,s){let r=i.createElement("canvas");r.className="lf-gl",r.setAttribute("aria-hidden","true"),e.after.after(r);let a=[],o=B=>(a.push(B),B),l=B=>{B.preventDefault(),s()};r.addEventListener("webglcontextlost",l,!1);let c;try{c=new sl({canvas:r,antialias:t.antialias,alpha:!0})}catch(B){throw r.removeEventListener("webglcontextlost",l),r.remove(),B}c.setPixelRatio(Math.min(n.devicePixelRatio||1,t.pixelRatioCap)),c.setClearColor(0,0),c.shadowMap.enabled=t.shadows,c.shadowMap.type=ki,c.shadowMap.autoUpdate=!1;let h=new sr,u=new Vt(15,1,1,2e3);u.layers.enable(2);let d=new Vt(60,.5,.08,220);d.layers.enable(1),h.add(new Tr(16775144,11970180,1.55));let f=new Rr(16773336,2);f.position.set(Ji[0]*40,Ji[1]*40,Ji[2]*40),f.castShadow=t.shadows;let x=n.smallScreen?1024:2048;f.shadow.mapSize.set(x,x),Object.assign(f.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:5,far:90}),f.shadow.bias=-6e-4,f.shadow.normalBias=.03,f.shadow.radius=3,h.add(f);let b=new Map,m=(B,W)=>{let ae=B+(W?JSON.stringify(W):""),me=b.get(ae);return me||(me=o(new Sr({color:B,...W})),b.set(ae,me)),me},p=(B,W,ae=0,me=0,Le=0,Fe=!0,ze=!0)=>{o(B);let ye=new vt(B,W);return ye.position.set(ae,me,Le),ye.castShadow=Fe,ye.receiveShadow=ze,h.add(ye),ye},S=at.slab,w=B=>{let W=S.w/2-B,ae=S.d/2-B,me=S.r-B,Le=new bs;return Le.moveTo(-W+me,-ae),Le.lineTo(W-me,-ae),Le.quadraticCurveTo(W,-ae,W,-ae+me),Le.lineTo(W,ae-me),Le.quadraticCurveTo(W,ae,W-me,ae),Le.lineTo(-W+me,ae),Le.quadraticCurveTo(-W,ae,-W,ae-me),Le.lineTo(-W,-ae+me),Le.quadraticCurveTo(-W,-ae,-W+me,-ae),Le},y=(B,W,ae,me,Le,Fe)=>{let ze=new vr(w(B+ae),{depth:W,bevelEnabled:!0,bevelThickness:ae,bevelSize:ae,bevelSegments:2,curveSegments:6});ze.rotateX(-Math.PI/2);let ye=p(ze,[m(Le),m(Fe)]);ye.position.y=me-W-ae};y(0,S.grass-.1,.05,0,gt.grass,gt.grassSide),y(.04,S.earth-.1,.05,-S.grass,gt.earth,gt.earth),p(new yn(140,140).rotateX(-Math.PI/2),o(new Mr({opacity:.13,color:4601886})),0,-S.grass-S.earth-.01,0,!1).layers.set(2),p(new mi(170,48).rotateX(-Math.PI/2),m("#cfcba0"),0,-.03,0,!1,!1).layers.set(1);{let B=[],W=11,ae=()=>(W=W*16807%2147483647,(W-1)/2147483646);for(let ze=0;ze<90;ze++){let ye=ae()*Math.PI*2,v=21+ae()*40,N=Math.cos(ye)*v,Z=Math.sin(ye)*v*.85;Math.abs(N)<19&&Math.abs(Z)<15.5||B.push({x:N,z:Z,s:1.1+ae()*1.4})}let me=o(new Ss(1,0)),Le=new Ut,Fe=new Oi(me,m("#b3b98d",{flatShading:!0}),B.length);B.forEach((ze,ye)=>{Le.position.set(ze.x,1.6*ze.s,ze.z),Le.scale.set(1.3*ze.s,1.6*ze.s,1.3*ze.s),Le.rotation.set(0,ze.x,0),Le.updateMatrix(),Fe.setMatrixAt(ye,Le.matrix)}),Fe.layers.set(1),h.add(Fe)}let C=(B,W,ae)=>{let me=[],Le=[];B.forEach((ze,ye)=>{let v=B[Math.max(0,ye-1)],N=B[Math.min(B.length-1,ye+1)],Z=N[0]-v[0],X=N[1]-v[1],q=Math.hypot(Z,X)||1,Re=-X/q*W/2,De=Z/q*W/2;if(me.push(ze[0]+Re,ae,ze[1]+De,ze[0]-Re,ae,ze[1]-De),ye){let Se=ye*2;Le.push(Se-2,Se,Se-1,Se-1,Se,Se+1)}});let Fe=new Nt;return Fe.setAttribute("position",new ut(me,3)),Fe.setAttribute("normal",new ut(me.map((ze,ye)=>ye%3===1?1:0),3)),Fe.setIndex(Le),Fe},_=B=>m(B,{side:rn});p(C(Mn,at.streamW,.012),_(gt.water),0,0,0,!1),p(C(Mn.map(B=>[B[0]+.25,B[1]]),.14,.02),_(gt.waterLine),0,0,0,!1);let E=at.yard;p(new yn(E.x1-E.x0,E.z1-E.z0).rotateX(-Math.PI/2),m(gt.paving),(E.x0+E.x1)/2,.01,(E.z0+E.z1)/2,!1),p(new mi(1,40).rotateX(-Math.PI/2),m(gt.stone),at.pond.x,.008,at.pond.z,!1).scale.set(at.pond.rx+.2,1,at.pond.rz+.2),p(new mi(1,40).rotateX(-Math.PI/2),m(gt.water),at.pond.x,.016,at.pond.z,!1).scale.set(at.pond.rx,1,at.pond.rz),p(C(Wt.pts,at.pathW,.022),_(gt.path),0,0,0,!1);let k=B=>{let ae=B.x0-.3,me=B.x1+.3,Le=B.z0-.3,Fe=B.z1+.3,ze=(B.z0+B.z1)/2,ye=B.h,v=B.h+B.roof,N=[ae,ye,Fe,me,ye,Fe,me,v,ze,ae,ye,Fe,me,v,ze,ae,v,ze,me,ye,Le,ae,ye,Le,ae,v,ze,me,ye,Le,ae,v,ze,me,v,ze,ae+.3,ye,Fe-.3,ae+.3,v,ze,ae+.3,ye,Le+.3,me-.3,ye,Le+.3,me-.3,v,ze,me-.3,ye,Fe-.3,ae,ye-.02,Le,me,ye-.02,Le,me,ye-.02,Fe,ae,ye-.02,Le,me,ye-.02,Fe,ae,ye-.02,Fe],Z=new Nt;return Z.setAttribute("position",new ut(N,3)),Z.computeVertexNormals(),Z},Y=(B,W,ae)=>{p(new Yt(B.x1-B.x0,B.h,B.z1-B.z0),m(gt.wall),(B.x0+B.x1)/2,B.h/2,(B.z0+B.z1)/2),p(k(B),m(W,{side:rn}));for(let me of ae)p(new Yt(me[1]-me[0],me[3]-me[2],.06),m(gt.dark),(me[0]+me[1])/2,(me[2]+me[3])/2,B.z1+.03,!1,!1)};Y(at.mill,gt.roof,[[-8.9,-8.1,0,1.3],[-11.4,-10.6,1.2,1.9],[-7.4,-6.8,1.2,1.9]]),Y(at.barn,gt.roof2,[[8.5,9.3,0,1.2]]);let J=at.wheel,O=new un;O.position.set(J.x-J.w/2,J.y,J.z);let $=m(gt.wood),V=m("#8f7457");for(let B of[-J.w/2,J.w/2]){let W=new vt(o(new br(J.r,.08,5,28).rotateY(Math.PI/2)),V);W.position.x=B,W.castShadow=!0,O.add(W)}let ie=o(new Yt(J.w+.1,.06,.42)),he=o(new Yt(.08,J.r*2,.08));for(let B=0;B<12;B++){let W=B/12*Math.PI*2,ae=new vt(ie,$);if(ae.position.set(0,Math.cos(W)*(J.r-.1),Math.sin(W)*(J.r-.1)),ae.rotation.x=-W,ae.castShadow=!0,O.add(ae),B%3===0){let me=new vt(he,V);me.rotation.x=W,O.add(me)}}O.add(new vt(o(new sn(.2,.2,J.w+.4,10).rotateZ(Math.PI/2)),V)),O.rotation.x=-.4,h.add(O);let xe=at.fountain;p(new sn(1,1.05,.38,20),m(gt.stone),xe.x,.19,xe.z),p(new sn(.86,.86,.02,20),m(gt.water),xe.x,.37,xe.z,!1),p(new sn(.16,.2,.75,8),m(gt.stone),xe.x,.74,xe.z),p(new sn(.45,.3,.12,12),m(gt.stone),xe.x,1.14,xe.z);let ce=at.lookout,pe=ce.s/2;p(new Yt(ce.s,ce.h,ce.s),m(gt.stone),ce.x,ce.h/2,ce.z),p(new Yt(.12,.8,ce.s),$,ce.x+pe-.06,ce.h+.4,ce.z),p(new Yt(ce.s,.8,.12),$,ce.x,ce.h+.4,ce.z-pe+.06);let nt=new un;nt.position.set(at.poster.x,0,at.poster.z);{let B=(W,ae,me,Le,Fe)=>{let ze=new vt(o(W),ae);ze.position.set(me,Le,Fe),nt.add(ze)};B(new Yt(.12,1,.12),$,0,.5,0),B(new Yt(1,1.2,.08),m("#ffffff"),0,1.5,.08),B(new yn(1,.18),m(gt.route),0,2,.125),B(new yn(.6,.6),m(gt.ink),0,1.45,.125),B(new yn(.4,.4),m("#ffffff"),0,1.45,.13),B(new yn(.2,.2),m(gt.ink),0,1.45,.135)}nt.scale.setScalar(.001),h.add(nt);let st={x:at.poster.x,z:at.poster.z+.13,y0:.9,y1:2.1,w:1},qe=ri.filter(B=>!B.kind),ee=ri.filter(B=>B.kind),ve=o(new Ss(1,0)),le=o(new ys(1,1,7).translate(0,.5,0)),Ne=o(new sn(.1,.14,1,6).translate(0,.5,0)),Pe=(B,W,ae,me)=>{let Le=new Oi(B,W,ae.length),Fe=new Ut;ae.forEach((ze,ye)=>{me(Fe,ze),Fe.updateMatrix(),Le.setMatrixAt(ye,Fe.matrix)}),Le.castShadow=!0,Le.receiveShadow=!0,h.add(Le)};Pe(ve,m(gt.tree,{flatShading:!0}),qe,(B,W)=>{B.position.set(W.x,1.75*W.s,W.z),B.scale.set(.95*W.s,.86*W.s,.95*W.s),B.rotation.set(0,W.x*3.1,0)}),Pe(le,m(gt.conifer,{flatShading:!0}),ee,(B,W)=>{B.position.set(W.x,.4*W.s,W.z),B.scale.set(.75*W.s,2.6*W.s,.75*W.s),B.rotation.set(0,W.z*2.3,0)}),Pe(Ne,m(gt.trunk),ri,(B,W)=>{B.position.set(W.x,0,W.z),B.scale.set(W.s,(W.kind?.5:.95)*W.s,W.s),B.rotation.set(0,0,0)});let Ee=at.oak;p(new sn(.26,.38,Ee.h,7).translate(0,Ee.h/2,0),m(gt.trunk),Ee.x,0,Ee.z);for(let B of[[-.5,Ee.h+.9,0,.8],[.7,Ee.h+.7,.3,.75],[0,Ee.h+1.4,-.4,.8]]){let W=new vt(ve,m(gt.tree,{flatShading:!0}));W.position.set(Ee.x+B[0],B[1],Ee.z+B[2]),W.castShadow=!0,W.receiveShadow=!0,W.scale.set(Ee.r*B[3],Ee.r*B[3]*.85,Ee.r*B[3]),h.add(W)}let Ye=[];for(let B=.3;B<Wt.len;B+=.62)Ye.push(B);let Ue=new Oi(o(new sn(.16,.16,.04,10)),o(new Bn({color:gt.route})),Ye.length);{let B=new Ut;Ye.forEach((W,ae)=>{let me=Wt.at(W);B.position.set(me.x,.05,me.z),B.updateMatrix(),Ue.setMatrixAt(ae,B.matrix)})}Ue.count=0,Ue.layers.set(2),h.add(Ue);let H=o(new mi(1,20).rotateX(-Math.PI/2)),K=o(new Bn({color:2762788,transparent:!0,opacity:.2,depthWrite:!1})),te=m(gt.route),ge=m(gt.ink),de=o(new Bn({color:16777215})),We=o(new zi(.44,18,12)),He=o(new ys(.33,.66,16).rotateX(Math.PI)),je=o(new zi(.18,12,8)),L=o(new sn(.035,.035,1,6).translate(0,.5,0)),T=B=>{let W=i.createElement("span");return W.className=B,e.tags.append(W),W},j=xn.map(B=>{let W=new un;W.position.set(B.pin[0],0,B.pin[1]);let ae=new un,me=new vt(He,te);me.position.y=-.42;let Le=new vt(je,de);ae.add(new vt(We,te),me,Le);let Fe=new vt(L,ge),ze=new vt(H,K);ze.position.y=.03,ze.scale.setScalar(.45),W.add(ae,Fe,ze),h.add(W);let ye=T("lf-tag"),v=i.createElement("b");return v.textContent=String(B.n),ye.append(v,i.createTextNode(B.name)),{g:W,head:ae,pole:Fe,blob:ze,eyeDot:Le,tag:ye,rise:0,base:.001}}),ue=T("lf-tag lf-start");ue.textContent="Start: the code";let M=T("lf-tag lf-who"),g=(B,W,ae)=>{B.rise=W,B.base=Math.min(1,Math.max(.001,W*1.3))*(1+.25*ae),B.blob.scale.setScalar(.45*Math.min(1,Math.max(.001,W))),B.g.visible=W>.001},F=B=>{for(let W of j){let ae=B*Math.max(0,W.rise);W.head.position.y=ae,W.pole.scale.y=Math.max(.001,ae-.75),W.pole.visible=ae>.8}},z=new un,G=te,re=ge,fe=new vt(o(new ur(.17,.3,4,10)),re);fe.position.y=.36;let Q=new vt(o(new zi(.15,14,10)),m(gt.paper));Q.position.y=.76;let ne=new vt(H,K);ne.position.y=.03,ne.scale.setScalar(.3),z.add(fe,Q,ne),z.visible=!1,z.traverse(B=>B.layers.set(2)),h.add(z);let be=0,ke=o(new Nt);ke.setAttribute("position",new ut([0,0,0,0,0,0,0,0,0],3)),ke.setAttribute("normal",new ut([0,1,0,0,1,0,0,1,0],3));let Ae=o(new Bn({color:gt.route,transparent:!0,opacity:0,depthWrite:!1,side:rn})),Me=new vt(ke,Ae);Me.layers.set(2),Me.visible=!1,Me.renderOrder=2,h.add(Me);let Ge=[];{let B=S.w/2,W=S.d/2;for(let[Le,Fe]of[[-B,-W],[B,-W],[B,W],[-B,W],[0,-W],[0,W],[-B,0],[B,0]])Ge.push([Le,0,Fe],[Le,-S.grass-S.earth,Fe]);let ae=at.mill,me=at.barn;Ge.push([ae.x0,ae.h+ae.roof,(ae.z0+ae.z1)/2],[ae.x1,ae.h+ae.roof,(ae.z0+ae.z1)/2],[me.x0,me.h+me.roof,(me.z0+me.z1)/2],[me.x1,me.h+me.roof,(me.z0+me.z1)/2]);for(let Le of ri)Ge.push([Le.x,2.7*Le.s,Le.z]);for(let Le of xn)Ge.push([Le.pin[0],at.pinH+1.9,Le.pin[1]]);Ge.push([at.poster.x,3.6,at.poster.z])}let Je=null,Ke=null,D=0,_e=0,se=B=>{let W=Je[B];return{az:W.az,el:W.el,d:W.d,fov:W.fov,target:W.target.clone(),big:Md[B].big,figS:Md[B].fig}},Te=(B,W,ae)=>({az:e_(B.az,W.az,ae),el:kr(B.el,W.el,ae),d:Math.exp(kr(Math.log(B.d),Math.log(W.d),ae)),fov:kr(B.fov,W.fov,ae),target:B.target.clone().lerp(W.target,ae),big:kr(B.big,W.big,ae),figS:kr(B.figS,W.figS,ae)}),Ie=B=>{u.fov=B.fov,u.position.copy(B.target).addScaledVector(Ed(B.az,B.el),B.d),u.near=Math.max(.5,B.d*.2),u.far=B.d*4+80,u.lookAt(B.target),u.updateProjectionMatrix()},oe="mill",Ve=B=>{let W=uh[B];d.position.set(W.pos[0],W.pos[1],W.pos[2]),d.fov=W.fov,d.aspect=Ke?Math.max(.2,Ke.screen.w/Ke.screen.h):.5,d.lookAt(W.target[0],W.target[1],W.target[2]),d.updateProjectionMatrix(),d.updateMatrixWorld()},Be=new U,_t=(B,W,ae,me,Le,Fe)=>(Be.set(W,ae,me).project(B),[(Be.x+1)/2*Le,(1-Be.y)/2*Fe,Be.z]),yt=new Map,Jt=(B,W,ae,me,Le,Fe)=>{if(yt.get(B)!==W&&(yt.set(B,W),B.classList.toggle("lf-on",W)),!W)return;let ze=_t(u,ae,me,Le,D,_e);B.style.transform=`translate(${ze[0].toFixed(1)}px,${(ze[1]-Fe).toFixed(1)}px) translate(-50%,-100%)`},Kt=B=>{if(!B||!Ke){e.leadLine.setAttribute("opacity","0"),e.leadDot.setAttribute("opacity","0");return}let W=Ke.phone.x-3,ae=Ke.phone.y+Ke.phone.h*.46;e.leadLine.setAttribute("x1",B[0].toFixed(1)),e.leadLine.setAttribute("y1",B[1].toFixed(1)),e.leadLine.setAttribute("x2",W.toFixed(1)),e.leadLine.setAttribute("y2",ae.toFixed(1)),e.leadDot.setAttribute("cx",B[0].toFixed(1)),e.leadDot.setAttribute("cy",B[1].toFixed(1)),e.leadLine.setAttribute("opacity",".6"),e.leadDot.setAttribute("opacity",".8")},Ls=null,Wi=!1,Xi=null,wi="over",Hr=!1,Fs=!0,Ns="",jt=!1,Ds=B=>{let ae=c.properties.get(B)?.currentProgram;return typeof ae?.isReady!="function"||ae.isReady()},Gr=(B,W,ae,me)=>{Ls=B;let Le=Ye.findIndex(ze=>ze>B.route);Ue.count=Le<0?Ye.length:Le,j.forEach((ze,ye)=>g(ze,B.pins[ye]??0,B.pulse[ye]??0)),nt.scale.setScalar(Math.max(.001,B.poster));let Fe=B.fig;if(Fe&&Fe.k>.001?(z.visible=!0,z.position.set(Fe.x,Fe.bob&&!n.reducedMotion?Math.abs(Math.sin(me*9))*.05:0,Fe.z),z.rotation.y=Fe.yaw,fe.material=Fe.who==="maker"?G:re,be=Fe.k,M.textContent=Fe.who==="maker"?"You":"A visitor",M.classList.toggle("lf-maker",Fe.who==="maker")):(z.visible=!1,be=0),Fe?.look&&B.wedge>.01){let ye=17*wd,v=Math.atan2(Fe.look[0]-Fe.x,Fe.look[1]-Fe.z),N=ke.attributes.position;N.setXYZ(0,Fe.x,.045,Fe.z),N.setXYZ(1,Fe.x+Math.sin(v-ye)*4.4,.045,Fe.z+Math.cos(v-ye)*4.4),N.setXYZ(2,Fe.x+Math.sin(v+ye)*4.4,.045,Fe.z+Math.cos(v+ye)*4.4),N.needsUpdate=!0,ke.computeBoundingSphere(),Me.visible=!0,Ae.opacity=.26*B.wedge}else Me.visible=!1;ae!==oe&&(oe=ae,Ve(oe)),Wi=W},Wr=()=>{if(!Xi||!Ke)return;let B=Xi;Ie(B);let W=B.big;for(let ye of j)ye.head.scale.setScalar(ye.base*W);F(at.pinH),z.scale.setScalar(Math.max(.001,B.figS*be));let ae=ye=>{for(let v of j){let N=ye.position.clone().sub(v.g.position);N.y=0,N.normalize().multiplyScalar(.33),v.eyeDot.position.set(N.x,.04,N.z)}};ae(u),c.setScissorTest(!1),c.setViewport(0,0,D,_e),c.setClearColor(0,0),Fs&&(c.shadowMap.needsUpdate=!0),c.render(h,u);let me=Ke,Le=(ye,v)=>ye<30||ye>D-30||v<22||v>_e-4||Wi&&ye>me.phone.x-8&&ye<me.phone.x+me.phone.w+8&&v>me.phone.y-8&&v<me.phone.y+me.phone.h+8;for(let ye of j){let v=at.pinH*Math.max(ye.rise,.6)+.45+.45*W,N=_t(u,ye.g.position.x,v,ye.g.position.z,D,_e);Jt(ye.tag,ye.rise>.6&&!Le(N[0],N[1]),ye.g.position.x,v,ye.g.position.z,4)}let Fe=_t(u,at.poster.x,2.3,at.poster.z,D,_e);Jt(ue,!!Ls&&Ls.poster>.6&&!Le(Fe[0],Fe[1]),at.poster.x,2.3,at.poster.z,6);let ze=.95*B.figS*be+.15;if(wi==="over"&&!Hr){let ye=z.visible&&be>.6;yt.get(M)!==ye&&(yt.set(M,ye),M.classList.toggle("lf-on",ye));let v=_t(u,z.position.x,0,z.position.z,D,_e);M.style.transform=`translate(${v[0].toFixed(1)}px,${(v[1]+7).toFixed(1)}px) translate(-50%,0)`}else Jt(M,z.visible&&be>.6,z.position.x,ze,z.position.z,4);if(Wi&&z.visible&&be>.5&&wi!=="over"){let ye=_t(u,z.position.x,.62*B.figS,z.position.z,D,_e);Kt([ye[0],ye[1]])}else Kt(null);if(Wi&&t.eyePass){let ye=me.screen;for(let v of j)v.head.scale.setScalar(v.base);F(at.eyePinH),ae(d),c.setScissorTest(!0),c.setScissor(ye.x,_e-ye.y-ye.h,ye.w,ye.h),c.setViewport(ye.x,_e-ye.y-ye.h,ye.w,ye.h),c.setClearColor(gt.sky,1),c.render(h,d),c.setScissorTest(!1),c.setViewport(0,0,D,_e),c.setClearColor(0,0)}Fs=!1},Ei=0;return{canvas:r,layout(B){if(jt||B.W<2||B.H<2)return;Ke=B,D=B.W,_e=B.H,c.setSize(D,_e,!1),u.aspect=D/_e;let W=D/_e;Je={over:Xc(Ge,Ki("over",B),W,Zr("over",B)),mill:Xc(Bs.mill,Ki("mill",B),W,Zr("mill",B)),poster:Xc(Bs.poster,Ki("poster",B),W,Zr("poster",B))},Ve(oe),Ei+=1},draw(B,W,ae){if(jt||!Je)return!1;let me=B.s,Le=B.u,Fe=W.from===W.to?1:W.k,ze=me.fig,ye=!!ze&&ze.bob===1&&!n.reducedMotion,v=[Ei,W.from,W.to,Fe.toFixed(4),me.route.toFixed(2),me.pins.map(N=>N.toFixed(3)).join(),me.pulse.map(N=>N.toFixed(2)).join(),me.poster.toFixed(3),ze?[ze.who,ze.x.toFixed(3),ze.z.toFixed(3),ze.k.toFixed(3),ze.yaw.toFixed(3),ye?ae.toFixed(3):0].join():"-",me.wedge.toFixed(3),Le.on,Le.eye].join("|");return v===Ns?!1:(Ns=v,Gr(me,Le.on,Le.eye,ae),Hr=Fe<1,wi=W.to,Xi=Fe>=1?se(W.to):Te(se(W.from),se(W.to),Ai(Fe)),Wr(),!0)},anchors(B,W,ae){Ve(B),d.aspect=Math.max(.2,W/Math.max(1,ae)),d.updateProjectionMatrix();let me=xn[0].pin,Le=_t(d,me[0],at.eyePinH+.55,me[1],W,ae),Fe=_t(d,me[0],.02,me[1],W,ae),ze=_t(d,st.x-st.w/2,st.y1,st.z,W,ae),ye=_t(d,st.x+st.w/2,st.y0,st.z,W,ae);return Ve(oe),{pin:[Le[0],Le[1]],ground:[Fe[0],Fe[1]],next:[W*.5,ae*.88],board:[Math.min(ze[0],ye[0]),Math.min(ze[1],ye[1]),Math.max(ze[0],ye[0]),Math.max(ze[1],ye[1])]}},prepare(){return jt?Promise.resolve():bd({compile:()=>{let B=[...c.compile(h,u)];return t.eyePass&&B.push(...c.compile(h,d)),B},isReady:Ds,stopped:()=>jt})},show(){r.classList.add("lf-on")},release(){if(!jt){jt=!0,r.removeEventListener("webglcontextlost",l);for(let B of a.splice(0))try{B.dispose()}catch{}c.dispose(),c.forceContextLoss(),r.remove(),e.tags.replaceChildren(),Kt(null)}}}}function Ad(i,e,t){let n=0,s=i.length-1,r=-1;for(;n<=s;){let a=n+s>>1,o=i[a];o!==void 0&&e(o)<=t?(r=a,n=a+1):s=a-1}return r}function Vr(i,e,t,n){if(!Number.isFinite(e)||(n?e<=t:e<t))throw new RangeError(`film timeline: ${i} must be a finite number ${n?">":">="} ${String(t)}, got ${String(e)}`)}function t_(i,e){if(i.length===0)throw new RangeError("film timeline: a film needs at least one part");i.forEach((t,n)=>{if(Vr(`part ${String(n)} durS`,t.durS,0,!0),t.views[0]?.atS!==0)throw new RangeError(`film timeline: part ${String(n)} must name its view at moment 0`);for(let r=1;r<t.views.length;r++){let a=t.views[r].atS;if(!(a>t.views[r-1].atS&&a<t.durS))throw new RangeError(`film timeline: part ${String(n)} view ${String(r)} must rise inside the part, got ${String(a)}`)}}),Vr("speed",e.speed,0,!0),Vr("holdS",e.holdS,0,!1),Vr("camS",e.camS,0,!0),Vr("settleS",e.settleS,0,!1)}function Rd(i,e){t_(i,e);let t=i.length-1,n=[],s=[],r=i[0].views[0].view,a=r,o=0;i.forEach((u,d)=>{let f=u.views[0].view,x=d>0&&f!==a,b=d===0?0:x?e.camS:e.settleS;x&&s.push({atS:o,from:a,to:f}),a=f;let m=u.durS/e.speed;for(let S of u.views.slice(1))S.view!==a&&(s.push({atS:o+b+S.atS/e.speed,from:a,to:S.view}),a=S.view);let p=d===t?0:e.holdS;n.push({index:d,startS:o,leadS:b,actS:m,holdS:p,endS:o+b+m+p}),o+=b+m+p});let l=o,c=u=>Number.isFinite(u)?Math.min(l,Math.max(0,u)):u===1/0?l:0,h=u=>n[Math.max(0,Ad(n,d=>d.startS,u))];return{totalS:l,segments:n,positionAt(u){let d=c(u),f=h(d),x=i[f.index].durS,b=f.endS-f.startS,m=b>0?Ti((d-f.startS)/b):1,p=d>=l,S=d-f.startS;if(p)return{beat:t,phase:"act",storyT:i[t].durS,segmentProgress:1,finished:p};if(S<f.leadS)return{beat:f.index,phase:"lead",storyT:0,segmentProgress:m,finished:p};if(S<f.leadS+f.actS){let w=Math.min(x,(S-f.leadS)*e.speed);return{beat:f.index,phase:"act",storyT:w,segmentProgress:m,finished:p}}return{beat:f.index,phase:"hold",storyT:x,segmentProgress:m,finished:p}},cameraAt(u){let d=c(u),f;for(let x of s)if(x.atS<=d)f=x;else break;return f===void 0?{from:r,to:r,k:1}:{from:f.from,to:f.to,k:Ti((d-f.atS)/e.camS)}},startOf(u){if(!Number.isInteger(u)||u<0||u>t)throw new RangeError(`film timeline: no part ${String(u)} in a film of ${String(i.length)}`);return n[u].startS}}}var n_={speed:.75,holdS:1.5,camS:1.1,settleS:.22,startShare:.5,leaveShare:.1,quality:Sd},i_=[0,.05,.1,.25,.5,.75,1];function s_(i){try{let e=i.createElement("canvas"),t=e.getContext("webgl2")??e.getContext("webgl");return t?(t.getExtension("WEBGL_lose_context")?.loseContext(),!0):!1}catch{return!1}}function r_(i){let e=i.defaultView,t=e?e.location.search:"",n=Jc(t);return{webgl:()=>s_(i),createScene:Td,observeView(s,r){if(!e||typeof e.IntersectionObserver!="function")return r(1),()=>{};let a=new e.IntersectionObserver(o=>{let l=o[o.length-1];l&&r(l.isIntersecting?l.intersectionRatio:0)},{threshold:i_});return a.observe(s),()=>a.disconnect()},observeSize(s,r){if(e&&typeof e.ResizeObserver=="function"){let a=new e.ResizeObserver(()=>r());for(let o of s)a.observe(o);return()=>a.disconnect()}return e?.addEventListener("resize",r),()=>e?.removeEventListener("resize",r)},viewport:()=>({w:e?.innerWidth??1024,h:e?.innerHeight??768,dpr:e?.devicePixelRatio??1}),now:()=>e?e.performance.now():Date.now(),size:s=>({w:s.clientWidth,h:s.clientHeight}),debug:n,quality:s=>n?eh(t,s):s}}function a_(i){for(let e of i.querySelectorAll(".lf-lb")){let t=e.querySelector(".lf-nm"),n=e.querySelector("rect");if(!t||!n||typeof t.getComputedTextLength!="function")continue;let s;try{s=t.getComputedTextLength()}catch{continue}if(!s)continue;let r=Number(e.dataset.h),a=Number(e.dataset.fs),o=Number(e.dataset.x),l=e.dataset.n==="1",c=s+(l?r+.3*a+.7*a:1.4*a),h=o-c/2;if(n.setAttribute("x",h.toFixed(2)),n.setAttribute("width",c.toFixed(2)),l){let u=e.querySelector("circle"),d=e.querySelector("text:not(.lf-nm)");u?.setAttribute("cx",(h+r/2).toFixed(2)),d?.setAttribute("x",(h+r/2).toFixed(2)),t.setAttribute("x",(h+r+.3*a).toFixed(2))}}}function o_(i,e,t){if(!e||!t){i.leadLine.setAttribute("opacity","0"),i.leadDot.setAttribute("opacity","0");return}let n=t.phone.x-3,s=t.phone.y+t.phone.h*.46;i.leadLine.setAttribute("x1",e[0].toFixed(1)),i.leadLine.setAttribute("y1",e[1].toFixed(1)),i.leadLine.setAttribute("x2",n.toFixed(1)),i.leadLine.setAttribute("y2",s.toFixed(1)),i.leadDot.setAttribute("cx",e[0].toFixed(1)),i.leadDot.setAttribute("cy",e[1].toFixed(1)),i.leadLine.setAttribute("opacity",".6"),i.leadDot.setAttribute("opacity",".8")}function l_(i,e,t=n_,n){if(!i||typeof i.append!="function"||!i.ownerDocument)throw new TypeError("landing film: host must be an element in a document");if(typeof e.onArStarting!="function")throw new TypeError("landing film: onArStarting must be a function");let s=i.ownerDocument,r={...r_(s),...n},a=s.defaultView,o=e.requestFrame??(H=>a?a.requestAnimationFrame(H):0),l=new Set,c=Rd(Sh,t),h=rh(s),u=Ah(h),d=r.debug?Zc(600):null,f=r.debug?th():null,x=r.quality(t.quality),b=1,m=vh({webgl:r.webgl()}),p=null,S=null,w=null,y=0,A="",R="",C=0,_=null,E=!1,P="",I=!1,k=null,Y=!1;h.captions.replaceChildren(...ml.map(H=>{let K=s.createElement("li");return K.textContent=H,K}));let J=()=>{if(!w)return;let H=u.eye(),K=`${String(y)}|${H}|${p?"3d":"floor"}`;if(K===R)return;R=K;let te=w.screen.w,ge=w.screen.h;u.place(p?p.anchors(H,te,ge):Th(H,te,ge),w)},O=H=>{if(Y)return;let K=c.positionAt(H),te=wh(K.beat,K.storyT);if(u.apply(te.u),J(),!w)return;if(p){p.draw(te,c.cameraAt(H),H);return}let ge=`${String(y)}|${yh(te.s,te.u.on)}`;if(ge===A)return;A=ge;let de=_h(te.s,te.u.on,w);h.floor.setAttribute("viewBox",de.viewBox),h.floor.setAttribute("preserveAspectRatio","xMidYMid meet"),h.floor.innerHTML=de.markup,a_(h.floor),o_(h,de.lead,w)},$=H=>{let K=Kc(H,pl,ml);ie.update(K),h.caption.textContent!==K.caption&&(h.caption.textContent=K.caption),K.captionsAsList!==I&&(I=K.captionsAsList,qe(I),ee(),ve()),h.root.classList.toggle("lf-paused",K.paused),h.root.classList.toggle("lf-finished",K.finished),H.status!=="playing"&&(_=null);let te=`${H.status}|${String(H.position.beat)}|${String(H.moving)}|${String(H.pausedBy)}`;te!==P&&(P=te,i.dataset.filmState=H.status,i.dataset.filmBeat=String(H.position.beat),i.dataset.playing=String(H.moving),i.dispatchEvent(new(a?.CustomEvent??CustomEvent)("landing-film-change",{detail:{status:H.status,beat:H.position.beat,moving:H.moving,pausedBy:H.pausedBy}}))),f&&d&&(h.debug.hidden=!1,h.debug.textContent=nh({renderer:p?"3d":"floor",quality:x,dpr:b,status:H.status,t:H.t,totalS:c.totalS,live:d.summary(),run:f.counts(),buildMs:C}))},V=Rh({timeline:c,reducedMotion:e.reducedMotion,startShare:t.startShare,leaveShare:t.leaveShare,requestFrame(H){let K=o(te=>{l.delete(K)||(_!==null&&(d?.push(te-_),f?.push(te-_)),_=te,H(te))});return K},cancelFrame(H){l.add(H),e.requestFrame||a?.cancelAnimationFrame(H)},render:O,onChange:$}),ie=Qc(s,{titles:pl,weights:c.segments.map(H=>H.endS-H.startS),onJump:H=>{pe(),V.jumpTo(H)},onToggle:()=>{pe(),V.toggle()}});h.stage.after(ie.element);let he=()=>{p=null,S=null,h.root.classList.remove("lf-3d"),A="",R=""},xe=H=>{H&&e.onFallback?.(H)},ce=()=>s.body?.dataset.arActive==="true";function pe(){if(Y||!m.wantsScene()||!w)return;if(ce()){E=!0;return}let H=r.now();try{let K=r.viewport(),te=0,ge=r.createScene(s,{stage:h.stage,after:h.floor,tags:h.tags,leadLine:h.leadLine,leadDot:h.leadDot},x,{reducedMotion:e.reducedMotion,devicePixelRatio:K.dpr,smallScreen:Math.min(K.w,K.h)<700},()=>nt(te));te=m.created(),S=ge,b=Math.min(K.dpr||1,x.pixelRatioCap),ge.layout(w);let de=()=>{Y||S!==ge||(p=ge,h.root.classList.add("lf-3d"),R="",ge.show(),V.redraw())};ge.prepare().then(de,de)}catch{he(),xe(m.createFailed())}C=Math.max(C,r.now()-H),V.redraw()}function nt(H){if(Y)return;let K=m.contextLost(H);if(!K)return;let te=S;he();try{te?.release()}catch{}xe(K),V.redraw()}let st=()=>{if(!Y){if(V.release(),E=!0,S){let H=S;he(),m.released(),H.release()}V.redraw()}};function qe(H){h.caption.hidden=H,h.captions.hidden=!H,h.root.classList.toggle("lf-list",H)}function ee(){if(h.stage.style.removeProperty("height"),!I)return;qe(!1);let{h:H}=r.size(h.stage);qe(!0),H>=2&&(k=H),k!==null&&(h.stage.style.height=`${String(k)}px`)}function ve(){if(Y)return;let{w:H,h:K}=r.size(h.stage);H<2||K<2||w&&w.W===H&&w.H===K||(w=mh(H,K,r.viewport().w),y+=1,u.layout(w),p?.layout(w),V.redraw())}let le=()=>{ee(),ve()},Ne=()=>{pe(),V.tap()},Pe=[...i.childNodes];i.replaceChildren(h.root),h.stage.addEventListener("click",Ne);let Ee=r.observeSize([i,h.stage],le);ve();let Ye=r.observeView(i,H=>{let K=Number.isFinite(H)?Math.min(1,Math.max(0,H)):0;xl(K,t.leaveShare)&&(E=!1),K>0&&!E&&pe(),V.setViewShare(ce()?0:K)}),Ue=e.onArStarting(st);return xe(m.initialFallback),V.redraw(),{totalS:c.totalS,segments:c.segments,snapshot:()=>V.snapshot(),jumpTo:H=>{pe(),V.jumpTo(H)},toggle:()=>{pe(),V.toggle()},renderer:()=>p?"3d":"floor",destroy(){if(!Y){V.destroy(),Y=!0;try{Ue()}catch{}if(Ye(),Ee(),h.stage.removeEventListener("click",Ne),S){let H=S;p=null,S=null,m.released(),H.release()}i.replaceChildren(...Pe),delete i.dataset.filmState,delete i.dataset.filmBeat,delete i.dataset.playing}}}}function SM(i,e){let t=l_(i,e);return{destroy:()=>t.destroy()}}export{n_ as DEFAULT_TUNING,l_ as createLandingFilm,SM as mountLandingFilm};
