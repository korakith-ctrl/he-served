export const LANDING_SCREEN_MINIMUM_MS = 2500;
export const LANDING_SCREEN_EXIT_MS = 560;

const LANDING_SCREEN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap');
  .zone2-minimal-splash { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; overflow: hidden; background: #FFFFFF; transition: opacity .5s ease, visibility .5s ease; }
  .zone2-minimal-splash.is-leaving { opacity: 0; visibility: hidden; }
  .zone2-minimal-stage { position: relative; width: clamp(104px, 30vw, 132px); aspect-ratio: 1058 / 1352; }
  .zone2-minimal-mark { position: relative; width: 100%; height: 100%; transform: translate3d(0,0,0); will-change: transform; animation: zone2MinimalLift .9s cubic-bezier(.45,0,.25,1) .52s forwards; }
  .zone2-minimal-mark::before { content: ""; position: absolute; z-index: -1; inset: 18% 5%; border-radius: 50%; background: rgba(0,163,224,.1); filter: blur(30px); opacity: .22; }
  .zone2-minimal-logo-crop { position: absolute; inset: 0; overflow: hidden; }
  .zone2-minimal-logo-crop img { position: absolute; width: 193.57%; height: auto; max-width: none; left: -46.79%; top: -25.74%; display: block; }
  .zone2-minimal-tagline { position: absolute; top: calc(100% + 6px); left: 50%; color: #536F7E; font-family: 'Space Grotesk', sans-serif; font-size: clamp(10px, 3vw, 13px); font-weight: 700; letter-spacing: .18em; line-height: 1; white-space: nowrap; opacity: 0; transform: translate(-50%, 10px); animation: zone2MinimalTextFade .72s ease 1.18s forwards; }
  @keyframes zone2MinimalLift { from { transform: translate3d(0,0,0); } to { transform: translate3d(0,-22px,0); } }
  @keyframes zone2MinimalTextFade { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (prefers-reduced-motion: reduce) {
    .zone2-minimal-splash *, .zone2-minimal-splash *::before, .zone2-minimal-splash *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
`;

export default function LandingScreen({ leaving = false }) {
  return (
    <div>
      <style>{LANDING_SCREEN_CSS}</style>
      <div className={`zone2-minimal-splash${leaving ? " is-leaving" : ""}`} role="status" aria-label="กำลังเปิดร้าน ZONE 2">
        <div className="zone2-minimal-stage" aria-hidden="true">
          <div className="zone2-minimal-mark">
            <span className="zone2-minimal-logo-crop">
              <img src="/logo-zone2.png" alt="" />
            </span>
          </div>
          <div className="zone2-minimal-tagline">CRAFTED FOR PERFORMANCE</div>
        </div>
      </div>
    </div>
  );
}
