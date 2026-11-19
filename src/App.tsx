import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { emptyHolder, parseHolder, type HolderState } from "./engine/schema";
import { generateKey, packCard } from "./engine/protocol";
import { acceptCard, addKey, decks, importFile, removeCard, untrustIssuer, viewCards, type CardView, type ImportOutcome } from "./engine/holder";
import { revokePlug } from "./engine/plug";
import { NoStorage, askToKeepStorage, loadState, saveState } from "./store";
import { withExampleCards } from "./examples";
import { LINK_MARK, cardLink, unwrapInput } from "./links";
import { CardFace, Icon, formatDate, issuerColour, npub, shortNpub } from "./ui";

type Screen = { name: "album" } | { name: "card"; id: string } | { name: "add" } | { name: "check" } | { name: "apps" };
const nowIso = () => new Date().toISOString();
const BACKUP_FORMAT = "album-backup";

export default function App() {
  const [state, setState] = useState<HolderState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [noStorage, setNoStorage] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "album" });
  const [notice, setNotice] = useState<string | null>(null);
  const pendingLink = useRef<string | null>(null);

  useEffect(() => {
    if (location.hash.startsWith(LINK_MARK)) {
      pendingLink.current = location.href;
      history.replaceState(null, "", location.pathname + location.search);
    }
    loadState()
      .then(setState)
      .catch((error) => {
        if (error instanceof NoStorage) {
          setNoStorage(true);
          setState(emptyHolder);
        } else setLoadError(true);
      });
    askToKeepStorage();
    const onPop = (event: PopStateEvent) => setScreen((event.state as Screen | null) ?? { name: "album" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const go = useCallback((next: Screen, replace = false) => {
    try {
      if (replace) history.replaceState(next, "");
      else history.pushState(next, "");
    } catch {
      /* Some embedded previews refuse history changes. Moving between screens still works. */
    }
    setScreen(next);
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => {
    if (history.state && history.length > 1) history.back();
    else go({ name: "album" }, true);
  }, [go]);

  const update = useCallback((next: HolderState) => {
    setState(next);
    if (noStorage) return;
    saveState(next).catch(() => setNotice("Album couldn't save that change on this phone. Try again before closing Album."));
  }, [noStorage]);

  const receive = useCallback(
    (raw: string): string | null => {
      if (!state) return null;
      const outcome: ImportOutcome = importFile(state, unwrapInput(raw), nowIso());
      if (outcome.kind === "rejected") return outcome.reason;
      update(outcome.state);
      if (outcome.kind === "added") {
        setNotice("Added to your Album.");
        go({ name: "card", id: outcome.id });
      } else if (outcome.kind === "quarantined") go({ name: "check" });
      else if (outcome.kind === "duplicate") setNotice("You already have this card.");
      else if (outcome.kind === "revocations")
        setNotice(outcome.revokedHere === 0 ? "Withdrawn list checked. None of your cards from this issuer are withdrawn." : "Withdrawn list checked. " + outcome.revokedHere + " of your cards from this issuer are withdrawn.");
      else if (outcome.kind === "bundle")
        setNotice(outcome.added + " added, " + outcome.quarantined + " waiting to be checked, " + outcome.duplicate + " you already had, " + outcome.rejected + " refused.");
      return null;
    },
    [state, update, go],
  );

  useEffect(() => {
    if (state && pendingLink.current) {
      const link = pendingLink.current;
      pendingLink.current = null;
      const problem = receive(link);
      if (problem) setNotice(problem);
    }
  }, [state, receive]);

  const views = useMemo(() => (state ? viewCards(state, Date.now()) : []), [state]);

  if (loadError)
    return (
      <main className="app">
        <div className="screen">
          <h1 className="h1 sm">Album couldn't read what it has stored</h1>
          <p className="small">Nothing has been changed or deleted. If you have a backup file, you can load it in a fresh copy of Album.</p>
        </div>
      </main>
    );
  if (!state)
    return (
      <main className="app">
        <div className="screen">
          <p className="soft">Opening your Album…</p>
        </div>
      </main>
    );

  const tab = screen.name === "add" ? "add" : screen.name === "apps" ? "apps" : "album";
  const showTabs = screen.name === "album" || screen.name === "add" || screen.name === "apps";
  return (
    <main className="app">
      {noStorage && (
        <div className="know" role="note" style={{ margin: "12px 20px 0", width: "auto", cursor: "default" }}>
          {Icon.info()}
          <span className="small">This browser gives Album nowhere to keep cards, so everything here goes when you close it.</span>
        </div>
      )}
      {notice && (
        <div className="notice" role="status" style={{ margin: "12px 20px 0" }}>
          {notice}
        </div>
      )}
      {screen.name === "album" && <AlbumScreen state={state} views={views} go={go} update={update} />}
      {screen.name === "card" && <CardScreen views={views} id={screen.id} back={back} state={state} update={update} setNotice={setNotice} />}
      {screen.name === "add" && <AddScreen state={state} receive={receive} update={update} setNotice={setNotice} />}
      {screen.name === "check" && <CheckScreen state={state} views={views} back={back} update={update} go={go} setNotice={setNotice} />}
      {screen.name === "apps" && <AppsScreen state={state} views={views} update={update} setNotice={setNotice} />}
      {showTabs && (
        <nav className="tabs" aria-label="Main">
          <button type="button" aria-current={tab === "album" ? "page" : undefined} onClick={() => go({ name: "album" }, true)}>
            {Icon.album()}Album
          </button>
          <button type="button" aria-current={tab === "add" ? "page" : undefined} onClick={() => go({ name: "add" }, true)}>
            {Icon.plus(24)}Add
          </button>
          <button type="button" aria-current={tab === "apps" ? "page" : undefined} onClick={() => go({ name: "apps" }, true)}>
            {Icon.apps()}Apps
          </button>
        </nav>
      )}
    </main>
  );
}

type Go = (screen: Screen, replace?: boolean) => void;
type Update = (state: HolderState) => void;

const isExample = (view: CardView) => view.held.definition.content.includes('"issuerName":"Example ');

function AlbumScreen({ state, views, go, update }: { state: HolderState; views: CardView[]; go: Go; update: Update }) {
  const held = views.filter((view) => view.held.status === "held");
  const waiting = views.filter((view) => view.held.status === "quarantined");
  const allDecks = decks(views);
  const examples = views.filter(isExample);
  const removeExamples = () => {
    let next = state;
    for (const view of examples) next = removeCard(next, view.id);
    const exampleIssuers = new Set(examples.map((view) => view.held.award.pubkey));
    for (const pubkey of exampleIssuers) next = untrustIssuer(next, pubkey);
    next = { ...next, keys: next.keys.filter((key) => key.label !== "Example issuer") };
    update(next);
  };
  return (
    <div className="screen">
      <div className="between">
        <div className="col" style={{ gap: 4 }}>
          <h1 className="h1">Album</h1>
          <p className="soft" style={{ fontSize: 15 }}>
            {held.length} {held.length === 1 ? "card" : "cards"} on {allDecks.length} {allDecks.length === 1 ? "page" : "pages"}
          </p>
        </div>
        <button type="button" className="round" aria-label="Add a card" onClick={() => go({ name: "add" }, true)}>
          {Icon.plus()}
        </button>
      </div>

      {waiting.length > 0 && (
        <button type="button" className="know" onClick={() => go({ name: "check" })} style={{ alignItems: "center" }}>
          {Icon.info()}
          <span className="col grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {waiting.length} {waiting.length === 1 ? "card" : "cards"} waiting to be checked
            </span>
            <span className="tiny soft">Kept out of your Album until you decide</span>
          </span>
          {Icon.chevron()}
        </button>
      )}

      {held.length === 0 && waiting.length === 0 && (
        <div className="panel">
          <h2 className="h3">No cards yet</h2>
          <p className="small">An issuer sends you a card as a file, a QR code or a link. Album checks its signature and keeps it on this phone.</p>
          <button type="button" className="btn" onClick={() => go({ name: "add" }, true)}>
            Add a card
          </button>
          <button type="button" className="btn second" onClick={() => update(withExampleCards(state, nowIso()))}>
            Try it with example cards
          </button>
        </div>
      )}

      {allDecks.map((deck) => (
        <section key={deck.issuer} className="stack" aria-label={deck.label}>
          <div className="deckhead">
            <h2 className="h2">{deck.label}</h2>
            <span className="small soft">{deck.cards.length}</span>
          </div>
          <p className="tiny soft">
            {deck.tier === "trusted" ? "An issuer you trust" : deck.tier === "unknown" ? "An issuer you don't trust any more" : "Built in"} · <span className="mono">{shortNpub(deck.issuer)}</span>
          </p>
          <div className="grid">
            {deck.cards.map((view) => (
              <CardFace key={view.id} view={view} onOpen={() => go({ name: "card", id: view.id })} />
            ))}
          </div>
        </section>
      ))}

      {examples.length > 0 && (
        <button type="button" className="btn danger" onClick={removeExamples}>
          Remove the example cards
        </button>
      )}
    </div>
  );
}

function CardScreen({ views, id, back, state, update, setNotice }: { views: CardView[]; id: string; back: () => void; state: HolderState; update: Update; setNotice: (text: string) => void }) {
  const [side, setSide] = useState<"front" | "back">("front");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const view = views.find((item) => item.id === id);
  if (!view)
    return (
      <div className="screen">
        <BackButton back={back} />
        <p>This card isn't in your Album any more.</p>
      </div>
    );
  const card = view.card;
  const checks = view.checks;
  const share = async () => {
    const link = cardLink(location.href, packCard(view.held.definition, view.held.award));
    try {
      if (navigator.share) await navigator.share({ title: card?.definition.title ?? "Card", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setNotice("Card link copied.");
      }
    } catch {
      /* The person closed the share sheet. Nothing to do. */
    }
  };
  return (
    <div className="screen">
      <div className="between" style={{ alignItems: "center" }}>
        <BackButton back={back} />
        <div className="toggle" role="group" aria-label="Side of the card">
          <button type="button" aria-pressed={side === "front"} onClick={() => setSide("front")}>
            Front
          </button>
          <button type="button" aria-pressed={side === "back"} onClick={() => setSide("back")}>
            Back
          </button>
        </div>
      </div>

      {side === "front" && <CardFace view={view} big />}

      {side === "back" && (
        <div className="panel facts" style={{ padding: 22 }}>
          <h1 className="h2">{card?.definition.title ?? "Broken card"}</h1>
          {card ? (
            <>
              <Fact k="What it proves" v={card.definition.description} />
              <Fact k="On this card" v={card.claims.claim} />
              <Fact k="How it's earned" v={card.definition.criteria} />
              <div className="col" style={{ gap: 4 }}>
                <span className="k">Issued by</span>
                <span className="v">{checks.issuerLabel}</span>
                <span className="mono soft">{shortNpub(card.issuer)}</span>
              </div>
              <Fact k="Issued" v={formatDate(card.awardedAt)} />
            </>
          ) : (
            <p className="small">{view.problem}</p>
          )}
          <div className="stack">
            {checks.signature === "valid" ? (
              <div className="okbox">{Icon.tick()}<span><strong>Signature checked.</strong> This card is exactly as the issuer signed it.</span></div>
            ) : (
              <div className="badbox">{Icon.cross()}<span><strong>The signature doesn't match.</strong> This card has been altered or forged.</span></div>
            )}
            {checks.status === "active" && checks.statusAsOf && (
              <div className="okbox">{Icon.tick()}<span>Not withdrawn, as of the issuer's list checked {formatDate(Date.parse(checks.statusAsOf) / 1000)}</span></div>
            )}
            {checks.status === "unknown" && card && <p className="tiny soft">Not yet checked against the issuer's list of withdrawn cards.</p>}
            {checks.status === "revoked" && <div className="badbox">{Icon.cross()}<span><strong>Withdrawn.</strong> The issuer has withdrawn this card.</span></div>}
            {checks.status === "expired" && <div className="badbox">{Icon.cross()}<span><strong>Expired.</strong> This card's date has passed.</span></div>}
            {checks.holderKey === "not-yours" && card && (
              <div className="know" style={{ cursor: "default" }}>
                {Icon.info()}
                <span className="small">This card was given to a key that isn't in this Album, so you can't prove it's yours.</span>
              </div>
            )}
          </div>
          <p className="tiny soft">A card gives you nothing to spend. What it means is up to each app that asks to see it.</p>
        </div>
      )}

      <div className="stack">
        <button type="button" className="btn second" onClick={share}>
          Share this card
        </button>
        <p className="tiny soft">Whoever you send it to sees the card and the card key it was given to.</p>
        {!confirmRemove ? (
          <button type="button" className="btn danger" onClick={() => setConfirmRemove(true)}>
            Remove from Album
          </button>
        ) : (
          <div className="badbox" style={{ flexDirection: "column" }}>
            <strong>Remove this card?</strong>
            <span>It's gone from this phone unless you have a backup or the issuer sends it again.</span>
            <div className="row">
              <button type="button" className="btn small" style={{ background: "#A3111D" }} onClick={() => { update(removeCard(state, view.id)); back(); }}>
                Remove it
              </button>
              <button type="button" className="btn small second" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = { new (options: { formats: string[] }): Detector };
function detectorClass(): DetectorClass | null {
  return (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector ?? null;
}

function Scanner({ onRead, onClose }: { onRead: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const Detector = detectorClass();
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        if (stopped) return media.getTracks().forEach((track) => track.stop());
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          video.current.play().catch(() => undefined);
        }
        const look = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found[0]?.rawValue) return onRead(found[0].rawValue);
          } catch {
            /* Not ready yet; try again. */
          }
          timer = window.setTimeout(look, 300);
        };
        look();
      })
      .catch(() => setProblem("Album couldn't use the camera. Check the camera permission for this site."));
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onRead]);
  return (
    <div className="stack">
      {problem ? <p className="small">{problem}</p> : <video ref={video} className="scan" muted playsInline aria-label="Camera view for scanning" />}
      <button type="button" className="btn second" onClick={onClose}>
        Stop scanning
      </button>
    </div>
  );
}

function AddScreen({ state, receive, update, setNotice }: { state: HolderState; receive: (raw: string) => string | null; update: Update; setNotice: (text: string) => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const canScan = detectorClass() !== null && !!navigator.mediaDevices?.getUserMedia;
  const tryAdd = (raw: string) => {
    const reason = receive(raw);
    setProblem(reason);
    if (!reason) setText("");
  };
  const onRead = useCallback((value: string) => {
    setScanning(false);
    setProblem(receive(value));
  }, [receive]);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8_000_000) return setProblem("That file is too large to be a card.");
    tryAdd(await file.text());
    if (fileInput.current) fileInput.current.value = "";
  };
  const makeKey = () => {
    const label = keyLabel.trim();
    if (!label) return;
    const next = addKey(state, label, generateKey(), nowIso());
    if (next === state) return setNotice("Album couldn't make that key. Use a shorter name, up to 60 letters.");
    update(next);
    setKeyLabel("");
  };
  const copy = async (pubkey: string) => {
    try {
      await navigator.clipboard.writeText(npub(pubkey));
      setNotice("Card key copied.");
    } catch {
      setNotice("Album couldn't copy. Press and hold the key to copy it.");
    }
  };
  return (
    <div className="screen">
      <div className="col">
        <h1 className="h1 sm" style={{ fontSize: 34 }}>Add a card</h1>
        <p className="soft" style={{ fontSize: 15 }}>Cards stay on this phone. Nothing is published unless you choose to share it.</p>
      </div>

      {scanning ? (
        <Scanner onRead={onRead} onClose={() => setScanning(false)} />
      ) : (
        <div className="stack">
          {canScan && (
            <button type="button" className="btn big" onClick={() => setScanning(true)}>
              {Icon.qr()}Scan a QR code
            </button>
          )}
          <button type="button" className="btn big second" style={{ minHeight: 64 }} onClick={() => fileInput.current?.click()}>
            {Icon.file()}Open a card file
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json,text/plain" className="sr" tabIndex={-1} aria-hidden="true" onChange={(event) => onFile(event.target.files?.[0])} />
          <div className="field">
            <label htmlFor="paste">Or paste a card link or card file</label>
            <textarea id="paste" className="input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste here" />
            <button type="button" className="btn" disabled={!text.trim()} onClick={() => tryAdd(text)}>
              Add
            </button>
          </div>
          <p className="tiny soft">A withdrawn-cards list from an issuer is added the same way.</p>
        </div>
      )}

      {problem && (
        <div className="badbox" role="alert">
          {Icon.cross()}
          <span>{problem}</span>
        </div>
      )}

      <section className="panel" aria-labelledby="keys">
        <h2 id="keys" className="h3">Your card keys</h2>
        <p className="small" style={{ color: "#3E424A" }}>
          An issuer sends a card to a key. Make one key for each issuer, so issuers can't link your cards together. Give it to the issuer privately. For The Kop Fund, you sign a message with your lock naming this key. Never post it beside your lock.
        </p>
        {state.keys.map((key) => (
          <div key={key.publicKey} className="col" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{key.label}</span>
            <div className="row" style={{ gap: 8 }}>
              <code className="code">{npub(key.publicKey)}</code>
              <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => copy(key.publicKey)}>
                Copy
              </button>
            </div>
          </div>
        ))}
        <div className="field">
          <label htmlFor="keylabel">Make a key for an issuer</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="keylabel" className="input" value={keyLabel} maxLength={60} onChange={(event) => setKeyLabel(event.target.value)} placeholder="Issuer's name" />
            <button type="button" className="btn small" style={{ width: "auto", minHeight: 48 }} disabled={!keyLabel.trim()} onClick={makeKey}>
              Make
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CheckScreen({ state, views, back, update, go, setNotice }: { state: HolderState; views: CardView[]; back: () => void; update: Update; go: Go; setNotice: (text: string) => void }) {
  const waiting = views.filter((view) => view.held.status === "quarantined");
  return (
    <div className="screen">
      <BackButton back={back} />
      {waiting.length === 0 ? (
        <>
          <h1 className="h1 sm">Nothing waiting</h1>
          <p className="small soft">Every card you've added is in your Album.</p>
        </>
      ) : (
        waiting.map((view) => <WaitingCard key={view.id} view={view} state={state} update={update} go={go} setNotice={setNotice} />)
      )}
    </div>
  );
}

function WaitingCard({ view, state, update, go, setNotice }: { view: CardView; state: HolderState; update: Update; go: Go; setNotice: (text: string) => void }) {
  const card = view.card;
  const [label, setLabel] = useState(card?.definition.issuerName ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!card) return null;
  const unknownIssuer = view.checks.issuerTier === "unknown";
  const notYours = view.checks.holderKey === "not-yours";
  const trust = () => {
    const name = label.trim();
    if (!name) return;
    update(acceptCard(state, view.id, nowIso(), name));
    setNotice("You now trust " + name + ". The card is in your Album.");
    go({ name: "card", id: view.id }, true);
  };
  const keep = () => {
    update(acceptCard(state, view.id, nowIso()));
    go({ name: "card", id: view.id }, true);
  };
  return (
    <section className="stack" style={{ gap: 16, paddingBottom: 20, borderBottom: "1px solid #D8D3C6" }}>
      <h1 className="h1 sm">{unknownIssuer ? "You don't know this issuer yet" : "This card isn't addressed to you"}</h1>
      <div className="row" style={{ gap: 16 }}>
        <div style={{ width: 96, height: 128, flexShrink: 0, borderRadius: 12, border: "2px dashed #8A5A00", background: "repeating-linear-gradient(135deg,#FBF1DC 0 10px,#F6F3EC 10px 20px)", display: "flex", alignItems: "flex-end", padding: 10 }}>
          <span style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 15, lineHeight: 1.1 }}>{card.definition.title}</span>
        </div>
        <div className="col">
          <span className="tiny soft">Says it's from</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{card.definition.issuerName}</span>
          <span className="mono soft">{shortNpub(card.issuer)}</span>
          <span className="swatch" style={{ width: 24, height: 8, borderRadius: 4, background: issuerColour(card.issuer) }} aria-hidden="true" />
        </div>
      </div>
      <div className="know" style={{ cursor: "default" }}>
        {Icon.info()}
        <div className="col" style={{ gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Know this before you go on</span>
          <span className="small">
            {unknownIssuer
              ? "The card's signature is real. Album can't tell you who owns the key that made it. Anyone can call themselves anything. Check the key with the issuer another way first."
              : "It was given to a key that isn't in this Album. You can keep it, but you can't prove it's yours."}
          </span>
        </div>
      </div>
      {unknownIssuer && notYours && <p className="small">It was also given to a key that isn't in this Album, so even once you trust the issuer you can't prove it's yours.</p>}
      <p className="small soft">Until you decide, this card stays out of your Album and no app can see it.</p>
      {unknownIssuer ? (
        <div className="field">
          <label htmlFor={"label-" + view.id}>Your name for this issuer</label>
          <input id={"label-" + view.id} className="input" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} />
          <button type="button" className="btn" disabled={!label.trim()} onClick={trust}>
            Trust this issuer
          </button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={keep}>
          Keep it anyway
        </button>
      )}
      {!confirmDelete ? (
        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
          Delete this card
        </button>
      ) : (
        <div className="row">
          <button type="button" className="btn small" style={{ background: "#A3111D", width: "auto" }} onClick={() => update(removeCard(state, view.id))}>
            Delete it
          </button>
          <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function AppsScreen({ state, views, update, setNotice }: { state: HolderState; views: CardView[]; update: Update; setNotice: (text: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<HolderState | null>(null);
  const save = () => {
    const blob = new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 1, state }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "album-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.format !== BACKUP_FORMAT || parsed?.version !== 1) throw new Error();
      setPendingBackup(parseHolder(parsed.state));
    } catch {
      setNotice("That isn't an Album backup file, or it's damaged.");
    }
  };
  const countFrom = (pubkey: string) => views.filter((view) => view.held.status === "held" && view.held.award.pubkey === pubkey).length;
  return (
    <div className="screen" style={{ gap: 22 }}>
      <h1 className="h1 sm" style={{ fontSize: 34 }}>Apps</h1>

      <section className="col" style={{ gap: 4 }}>
        <h2 className="tiny soft" style={{ margin: "0 0 6px", fontWeight: 600 }}>Apps you've shown cards to</h2>
        {state.grants.length === 0 ? (
          <p className="small">No app has asked to see your cards yet. Apps that work with Album will ask here, one request at a time.</p>
        ) : (
          state.grants.map((grant) => (
            <div key={grant.app} className="listrow">
              <div className="col grow" style={{ gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{grant.app}</span>
                <span className="tiny soft">Can ask about {grant.slugs.length} {grant.slugs.length === 1 ? "card" : "cards"}</span>
              </div>
              <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => update(revokePlug(state, grant.app))}>
                Stop
              </button>
            </div>
          ))
        )}
      </section>

      <section className="col" style={{ gap: 4 }}>
        <h2 className="tiny soft" style={{ margin: "0 0 6px", fontWeight: 600 }}>Issuers you trust</h2>
        {state.trusted.length === 0 && <p className="small">None yet. You choose whom to trust when a card from a new issuer arrives.</p>}
        {state.trusted.map((issuer) => (
          <div key={issuer.pubkey} className="listrow">
            <span className="swatch" style={{ background: issuerColour(issuer.pubkey) }} aria-hidden="true" />
            <div className="col grow" style={{ gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{issuer.label}</span>
              <span className="tiny soft">{countFrom(issuer.pubkey)} {countFrom(issuer.pubkey) === 1 ? "card" : "cards"} · <span className="mono">{shortNpub(issuer.pubkey)}</span></span>
            </div>
            <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => update(untrustIssuer(state, issuer.pubkey))}>
              Stop trusting
            </button>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2 className="h3">Take your cards with you</h2>
        <p className="small" style={{ color: "#3E424A" }}>Save every card and your card keys in one file. Lose the phone without it and your cards are gone. Keep the file private: anyone with it holds your card keys.</p>
        <button type="button" className="btn" onClick={save}>
          Save a backup file
        </button>
        <button type="button" className="btn second" onClick={() => fileInput.current?.click()}>
          Load a backup
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" className="sr" tabIndex={-1} aria-hidden="true" onChange={(event) => onFile(event.target.files?.[0])} />
        {pendingBackup && (
          <div className="badbox" style={{ flexDirection: "column" }}>
            <strong>Replace everything in this Album?</strong>
            <span>The backup has {pendingBackup.cards.length} cards and {pendingBackup.keys.length} card keys. What's here now will be gone.</span>
            <div className="row">
              <button type="button" className="btn small" style={{ background: "#A3111D", width: "auto" }} onClick={() => { update(pendingBackup); setPendingBackup(null); setNotice("Backup loaded."); }}>
                Replace
              </button>
              <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => setPendingBackup(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="tiny soft">Album keeps everything on this phone and talks to no server. It isn't encrypted yet, so anyone who can open Album on this phone can see your cards. Early build, not yet reviewed.</p>
      {state.cards.length === 0 && state.keys.length === 0 ? null : (
        <ResetAlbum update={update} />
      )}
    </div>
  );
}

function ResetAlbum({ update }: { update: Update }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm)
    return (
      <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
        Empty this Album
      </button>
    );
  return (
    <div className="badbox" style={{ flexDirection: "column" }}>
      <strong>Empty this Album?</strong>
      <span>Every card and card key on this phone is deleted. Only a backup file can bring them back.</span>
      <div className="row">
        <button type="button" className="btn small" style={{ background: "#A3111D", width: "auto" }} onClick={() => { update(emptyHolder); setConfirm(false); }}>
          Empty it
        </button>
        <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => setConfirm(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BackButton({ back }: { back: () => void }) {
  return (
    <button type="button" className="back" onClick={back} aria-label="Go back">
      {Icon.back()}Back
    </button>
  );
}
function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="k">{k}</span>
      <span className="v" style={{ whiteSpace: "pre-line" }}>{v}</span>
    </div>
  );
}
