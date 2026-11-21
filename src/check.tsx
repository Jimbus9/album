import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./styles.css";
import { PROOF_MARK, checkCode, checkProof, makeRequest, readProofInput, requestLink, type CheckResult, type Pending, type ProveRequest } from "./prove";
import { Icon, formatDate, npub, shortNpub } from "./ui";

/**
 * The check page. Anyone can use it, with no Album and no account. It gives out a fresh challenge, reads the
 * proof that comes back, and checks two signatures. Challenges are kept in this browser for 15 minutes.
 */
const KEEP = "album-check-pending";
const KEEP_SECONDS = 15 * 60;
const now = () => Math.floor(Date.now() / 1000);

function loadPending(): Pending[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEEP) ?? "[]") as Pending[];
    return Array.isArray(list) ? list.filter((item) => now() - item.madeAt < KEEP_SECONDS) : [];
  } catch {
    return [];
  }
}
function savePending(list: Pending[]) {
  try {
    localStorage.setItem(KEEP, JSON.stringify(list.slice(-20)));
  } catch {
    /* No storage here: the request still works while this page stays open. */
  }
}
function issuerHex(input: string): string | null | "bad" {
  const text = input.trim();
  if (!text) return null;
  if (/^[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  try {
    const decoded = nip19.decode(text);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {
    /* fall through */
  }
  return "bad";
}
function Qr({ text }: { text: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  // The library builds the SVG itself from the data; nothing from outside goes into the markup.
  return <div aria-label="QR code of the request" role="img" style={{ background: "#fff", padding: 12, borderRadius: 12, alignSelf: "center", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 5, margin: 0 }) }} />;
}

function CheckPage() {
  const [who, setWho] = useState("");
  const [issuer, setIssuer] = useState("");
  const [request, setRequest] = useState<ProveRequest | null>(null);
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const albumUrl = new URL("./", location.href).toString();

  const verify = (input: string) => {
    const bundle = readProofInput(input);
    if (!bundle) return setResult({ ok: false, reason: "That isn't an Album proof. Ask them to send it again." });
    const pending = loadPending();
    const outcome = checkProof(bundle, pending, now());
    if (outcome.ok) {
      // Each challenge works once.
      savePending(pending.filter((item) => item.challenge !== bundle.proof.proof.content));
      setRequest(null);
      setPasted("");
    }
    setResult(outcome);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const readHash = () => {
      if (!location.hash.startsWith(PROOF_MARK)) return;
      const hash = location.hash;
      history.replaceState(null, "", location.pathname + location.search);
      verify(hash);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const make = () => {
    const hex = issuerHex(issuer);
    if (hex === "bad") return setProblem("That issuer key isn't one Album can read. Use the npub… or 64-character key the issuer publishes.");
    setProblem(null);
    const made = makeRequest((who.trim() || "Album check page").slice(0, 80));
    savePending([...loadPending(), { challenge: made.challenge, audience: made.audience, issuer: hex, madeAt: now() }]);
    setRequest(made);
    setResult(null);
  };
  const link = request ? requestLink(albumUrl, request) : "";
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Prove a card", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setProblem("Link copied.");
      }
    } catch {
      /* closed */
    }
  };

  return (
    <main className="app">
      <div className="screen">
        <h1 className="h1 sm" style={{ fontSize: 34 }}>Check a card</h1>
        <p className="small">Check that someone holds a card, without trusting them, their phone or this page's word for it. Two signatures do the work: the issuer's on the card, and theirs on a fresh code from this page.</p>

        {result && (
          <section className="panel" aria-live="polite" style={{ borderColor: result.ok ? "#0A6B3B" : "#A3111D", borderWidth: 2 }}>
            {result.ok ? (
              <>
                <div className="row">{Icon.tick()}<h2 className="h2" style={{ color: "#0A6B3B" }}>Proved</h2></div>
                <p style={{ fontSize: 17 }}>They hold <strong>{result.card.definition.title}</strong>.</p>
                <div className="facts">
                  <div className="col" style={{ gap: 4 }}>
                    <span className="k">Signed by issuer key</span>
                    <span className="mono" style={{ wordBreak: "break-all" }}>{npub(result.card.issuer)}</span>
                    <span className="small soft">which calls itself "{result.card.definition.issuerName}". Anyone can call themselves anything: the key is what counts.</span>
                  </div>
                  {result.issuerMatches === true && <div className="okbox">{Icon.tick()}<span>That's the issuer key you gave.</span></div>}
                  {result.issuerMatches === false && <div className="badbox">{Icon.cross()}<span><strong>Not the issuer key you gave.</strong> This card is real, but from a different issuer.</span></div>}
                  {result.issuerMatches === null && <div className="know" style={{ cursor: "default" }}>{Icon.info()}<span className="small">You didn't give an issuer key. Check this one against the key the issuer publishes.</span></div>}
                  <div className="col" style={{ gap: 4 }}><span className="k">Issued</span><span className="v">{formatDate(result.card.awardedAt)}</span></div>
                  <div className="col" style={{ gap: 4 }}><span className="k">On the card</span><span className="v">{result.card.claims.claim}</span></div>
                  <p className="tiny soft">Not checked against the issuer's list of withdrawn cards. The proof was signed for "{result.audience}" in the last 10 minutes, and can't be used again here.</p>
                </div>
              </>
            ) : (
              <>
                <div className="row">{Icon.cross()}<h2 className="h2" style={{ color: "#A3111D" }}>Not proved</h2></div>
                <p className="small">{result.reason}</p>
              </>
            )}
          </section>
        )}

        {!request ? (
          <section className="panel">
            <h2 className="h3">1. Make a request</h2>
            <div className="field">
              <label htmlFor="who">Who's checking (shown to them)</label>
              <input id="who" className="input" maxLength={80} value={who} onChange={(event) => setWho(event.target.value)} placeholder="Album check page" />
            </div>
            <div className="field">
              <label htmlFor="issuer">Only accept cards from this issuer key (optional)</label>
              <input id="issuer" className="input" autoComplete="off" autoCapitalize="none" spellCheck={false} value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="npub1…" />
            </div>
            {problem && <p className="small" style={{ color: "#A3111D" }}>{problem}</p>}
            <button type="button" className="btn" onClick={make}>
              Make a request
            </button>
          </section>
        ) : (
          <section className="panel">
            <h2 className="h3">1. Show them this</h2>
            <p className="small">They scan it with their phone's camera, or open the link. Their Album asks them, then gives them a proof to send back. Check code <strong className="mono" style={{ fontSize: 15 }}>{checkCode(request.challenge)}</strong>: their Album shows it too.</p>
            <Qr text={link} />
            <button type="button" className="btn second" onClick={share}>
              Send the link instead
            </button>
            {issuer.trim() && <p className="tiny soft">Only cards from {shortNpub(issuerHex(issuer) as string)} pass.</p>}
            {problem && <p className="small">{problem}</p>}
            <button type="button" className="btn danger" style={{ color: "#16181D" }} onClick={() => setRequest(null)}>
              Start a new request
            </button>
          </section>
        )}

        <section className="panel">
          <h2 className="h3">2. Check their proof</h2>
          <p className="small">If they sent you a link, just open it on this phone. Or paste what they sent.</p>
          <div className="field">
            <label htmlFor="proof">Their proof</label>
            <textarea id="proof" className="input" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="ALBUM-PROOF:…" />
          </div>
          <button type="button" className="btn" disabled={!pasted.trim()} onClick={() => verify(pasted)}>
            Check it
          </button>
        </section>
        <p className="tiny soft">This page talks to no server. The codes it gives out are kept in this browser for 15 minutes. <a href="./">Open Album</a></p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CheckPage />
  </StrictMode>,
);
