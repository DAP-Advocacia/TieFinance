// Símbolo do login (do TieFinance_Kit) com brilho em varredura. CSS da animação em globals.css (.tf-*).
export function Symbol() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -80 496 429" role="img" aria-label="TieFinance">
      <defs>
        <linearGradient id="tf-left" x1="0" y1=".8" x2="1" y2=".1"><stop stopColor="#b48022" /><stop offset=".48" stopColor="#f5bf50" /><stop offset=".78" stopColor="#fff3a4" /><stop offset="1" stopColor="#d4af37" /></linearGradient>
        <linearGradient id="tf-fold" x1=".2" y1=".05" x2=".75" y2="1"><stop stopColor="#7d6210" /><stop offset=".28" stopColor="#94630f" /><stop offset=".57" stopColor="#dba83d" /><stop offset="1" stopColor="#f4d068" /></linearGradient>
        <linearGradient id="tf-shine" x1=".75" y1="0" x2=".18" y2="1"><stop stopColor="#8a5c10" /><stop offset=".5" stopColor="#c58c26" /><stop offset="1" stopColor="#ffe38d" /></linearGradient>
        <linearGradient id="tf-stem1" x1=".1" y1="0" x2=".75" y2="1"><stop stopColor="#79500c" /><stop offset=".45" stopColor="#c18b2b" /><stop offset=".84" stopColor="#e5b04b" /><stop offset="1" stopColor="#ab7520" /></linearGradient>
        <linearGradient id="tf-stem2" x1=".1" y1="0" x2=".65" y2="1"><stop stopColor="#78500a" /><stop offset=".5" stopColor="#c48b27" /><stop offset="1" stopColor="#ffe18a" /></linearGradient>
        <linearGradient id="tf-sweep" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <radialGradient id="tf-halo" cx=".5" cy=".5" r=".5"><stop stopColor="#f4d068" stopOpacity=".3" /><stop offset=".6" stopColor="#f4d068" stopOpacity=".08" /><stop offset="1" stopColor="#f4d068" stopOpacity="0" /></radialGradient>
        <clipPath id="tf-clip">
          <path d="M97 142 140 114 140 237 97 269Z" /><path d="M140 114 183 85 183 206 140 237Z" />
          <path d="M0 64 64 0H225L112 64Z" /><path d="M225 0H296L226 64H218L97 144V72Z" />
        </clipPath>
      </defs>
      <ellipse className="tf-halo" cx="148" cy="130" rx="190" ry="170" fill="url(#tf-halo)" />
      <g className="tf-stem"><path d="M97 142 140 114 140 237 97 269Z" fill="url(#tf-stem1)" /><path d="M140 114 183 85 183 206 140 237Z" fill="url(#tf-stem2)" /><path d="M140 120V237" stroke="#f4d068" strokeOpacity=".55" strokeWidth=".8" /></g>
      <g className="tf-wing"><path d="M0 64 64 0H225L112 64Z" fill="url(#tf-left)" /><path d="M0 64 64 0H225" fill="none" stroke="#f4d068" strokeWidth=".65" /></g>
      <g className="tf-fold"><path d="M225 0H296L226 64H218L97 144V72Z" fill="url(#tf-fold)" /><path d="M225 0H296L226 64H218L140 116C145 79 162 39 190 20Z" fill="url(#tf-shine)" /><path d="M97 72 225 0" fill="none" stroke="#fff0b1" strokeWidth=".9" strokeOpacity=".8" /></g>
      <g clipPath="url(#tf-clip)" className="tf-sweep-wrap"><rect className="tf-sweep" x="-70" y="-30" width="70" height="330" fill="url(#tf-sweep)" /></g>
    </svg>
  );
}
