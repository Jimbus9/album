import { useEffect, useRef, useState } from "react";
import type { HolderState } from "./engine/schema";
import { WORDS, addPasskey, cleanWords, createVault, lockVault, newWords, unlockVault, unlockWithPasskey, wordsValid, type Stored, type Unlocked } from "./vault";
import { makePasskey, passkeysPossible, usePasskey } from "./passkey";
import { Icon } from "./ui";

const MIN_PASSCODE = 6;

/** What every box that takes recovery words uses, so the keyboard doesn't learn or suggest them. */
export const SECRET_WORDS = { autoComplete: "off", autoCorrect: "off", autoCapitalize: "none", spellCheck: false } as const;

/** Up to four standard words starting with what's typed. From the word list, never from the words themselves. */
export function suggestWords(prefix: string, n = 4): string[] {
  const p = prefix.trim().toLowerCase();
  return p ? WORDS.filter((word) => word.startsWith(p)).slice(0, n) : [];
}

/** A web page can't stop a screenshot, so the screens that show or take words say so. */
export function NoScreenshotsNote() {
  return <p className="tiny soft">Album can't block screenshots here: no web app can. Don't take one, and don't photograph the words or put them in notes, email or cloud storage.</p>;
}

/** Check a paper copy, every word, one at a time, the way the Crowdlock app and a hardware wallet do. */
export function CheckEveryWord({ words, onDone, onShowAgain }: { words: string; onDone: () => void; onShowAgain: () => void }) {
  const list = words.split(" ");
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const accept = (word: string) => {
    if (word.trim().toLowerCase() !== list[i]) return setWrong(true);
    setWrong(false);
    setTyped("");
    if (i + 1 === list.length) onDone();
    else {
      setI(i + 1);
      box.current?.focus();
    }
  };
  return (
    <>
      <h1 className="h1 sm">Check your paper</h1>
      <p className="small">Type each word from what you wrote down. Every word is checked: one wrong word and the paper wouldn't bring your card keys back.</p>
      <form className="field" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) accept(typed); }}>
        <label htmlFor="checkword">Word {i + 1} of {list.length}</label>
        <input id="checkword" ref={box} className="input" {...SECRET_WORDS} autoFocus value={typed} onChange={(event) => { setTyped(event.target.value); setWrong(false); }} />
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {suggestWords(typed).map((word) => (
            <button key={word} type="button" className="chip" onClick={() => accept(word)}>
              {word}
            </button>
          ))}
        </div>
        {wrong && <p className="small" style={{ color: "#A3111D" }} role="alert">That isn't word {i + 1}. Check your paper. If it's wrong there, go back and copy the words out again.</p>}
        <button type="submit" className="btn" disabled={!typed.trim()}>
          Next
        </button>
      </form>
      <button type="button" className="btn second" onClick={onShowAgain}>
        Show the words again
      </button>
      <NoScreenshotsNote />
    </>
  );
}

/** Typing recovery words in: suggestions as each word is typed, and a count that says whether they check out. */
export function WordsInput({ id, value, onChange }: { id: string; value: string; onChange: (text: string) => void }) {
  const endsWithSpace = /\s$/.test(value);
  const parts = value.split(/\s+/);
  const partial = endsWithSpace ? "" : (parts[parts.length - 1] ?? "");
  const suggestions = partial ? suggestWords(partial).filter((word) => word !== partial.toLowerCase() || suggestWords(partial).length > 1) : [];
  const pick = (word: string) => onChange((endsWithSpace ? value : value.slice(0, value.length - partial.length)) + word + " ");
  const count = cleanWords(value).split(" ").filter(Boolean).length;
  const valid = wordsValid(value);
  return (
    <>
      <textarea id={id} className="input" {...SECRET_WORDS} value={value} onChange={(event) => onChange(event.target.value)} style={{ fontSize: 15 }} />
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {suggestions.map((word) => (
          <button key={word} type="button" className="chip" onClick={() => pick(word)}>
            {word}
          </button>
        ))}
      </div>
      <p className="small" style={{ color: valid ? "#0A6B3B" : "#5A5E66" }}>
        {valid ? "Those words are valid." : count === 12 ? "12 words, but they don't check out. Look for a misspelt word." : count + (count === 1 ? " word" : " words") + " so far"}
      </p>
    </>
  );
}

/** First run: make or type the recovery words, choose a passcode, then the fingerprint or face if the phone can. */
export function SetupScreen({ carry, onDone }: { carry: HolderState; onDone: (unlocked: Unlocked, envelope: Stored) => void }) {
  const [step, setStep] = useState<"choose" | "show" | "check" | "restore" | "passcode" | "passkey">("choose");
  const [words, setWords] = useState("");
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const made = useRef<{ unlocked: Unlocked; envelope: Stored } | null>(null);

  const restore = () => {
    if (!wordsValid(typed)) return setProblem("Those aren't 12 recovery words. Check each word and the order.");
    setProblem(null);
    setWords(cleanWords(typed));
    setTyped("");
    setStep("passcode");
  };
  const finish = async () => {
    if (pass.length < MIN_PASSCODE) return setProblem("Use at least " + MIN_PASSCODE + " characters.");
    if (pass !== again) return setProblem("The two passcodes don't match.");
    setProblem(null);
    setBusy(true);
    try {
      const result = await createVault(words, pass, carry);
      setWords("");
      setPass("");
      setAgain("");
      setBusy(false);
      if (passkeysPossible()) {
        made.current = result;
        setStep("passkey");
      } else onDone(result.unlocked, result.envelope);
    } catch {
      setBusy(false);
      setProblem("Album couldn't lock itself on this phone. Try again.");
    }
  };
  const turnOn = async () => {
    const result = made.current;
    if (!result) return;
    setBusy(true);
    const passkey = await makePasskey();
    setBusy(false);
    if (!passkey.ok) return setProblem(passkey.reason);
    const unlocked = await addPasskey(result.unlocked, passkey.id, passkey.salt, passkey.output);
    onDone(unlocked, await lockVault(unlocked));
  };

  return (
    <div className="screen">
      {step === "choose" && (
        <>
          <h1 className="h1">Album</h1>
          <p style={{ fontSize: 17 }}>A wallet for signed cards. Your cards stay on this phone.</p>
          <div className="panel">
            <h2 className="h3">First, your recovery words</h2>
            <p className="small">Album makes 12 words. Every card key comes from them, so the words prove your cards are yours, on any phone, for good. Write them on paper and keep them safe.</p>
            <p className="small">Use new words for this. Never your bitcoin wallet's words.</p>
          </div>
          <button type="button" className="btn" onClick={() => { setWords(newWords()); setStep("show"); }}>
            Make my recovery words
          </button>
          <button type="button" className="btn second" onClick={() => { setProblem(null); setStep("restore"); }}>
            I already have recovery words
          </button>
        </>
      )}

      {step === "show" && (
        <>
          <h1 className="h1 sm">Write these down</h1>
          <p className="small">On paper, in order, and keep the paper safe. Anyone with these words can make your card keys. Lose them and your phone, and your cards can never be proved yours again.</p>
          <ol className="words" aria-label="Your recovery words">
            {words.split(" ").map((word, index) => (
              <li key={index}>{word}</li>
            ))}
          </ol>
          <NoScreenshotsNote />
          <button type="button" className="btn" onClick={() => { setProblem(null); setStep("check"); }}>
            I've written them down
          </button>
        </>
      )}

      {step === "check" && <CheckEveryWord words={words} onDone={() => setStep("passcode")} onShowAgain={() => setStep("show")} />}

      {step === "restore" && (
        <>
          <h1 className="h1 sm">Type your recovery words</h1>
          <p className="small">All 12, in order, with spaces between.</p>
          <div className="field">
            <label htmlFor="restore">Recovery words</label>
            <WordsInput id="restore" value={typed} onChange={(text) => { setTyped(text); setProblem(null); }} />
          </div>
          {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
          <button type="button" className="btn" disabled={!wordsValid(typed)} onClick={restore}>
            Continue
          </button>
          <button type="button" className="btn second" onClick={() => { setTyped(""); setStep("choose"); }}>
            Back
          </button>
          <NoScreenshotsNote />
        </>
      )}

      {step === "passcode" && (
        <>
          <h1 className="h1 sm">Choose a passcode</h1>
          <p className="small">It keeps your cards and words locked on this phone, and opens Album when your fingerprint or face can't. If you forget it, your recovery words start Album again.</p>
          {carry.cards.length > 0 && (
            <p className="small">Your {carry.cards.length} cards from before come with you. Their keys were made before the words, so the words can't bring those keys back.</p>
          )}
          <div className="field">
            <label htmlFor="pass">Passcode</label>
            <input id="pass" className="input" type="password" autoComplete="new-password" value={pass} onChange={(event) => setPass(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="again">The same again</label>
            <input id="again" className="input" type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
          </div>
          {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
          <button type="button" className="btn" disabled={busy || !pass || !again} onClick={finish}>
            {busy ? "Locking…" : "Lock Album with this passcode"}
          </button>
        </>
      )}

      {step === "passkey" && (
        <>
          <h1 className="h1 sm">Open with your fingerprint or face?</h1>
          <p className="small">Album makes a passkey on this phone. Your fingerprint or face then opens Album. Your passcode still works too.</p>
          <div className="know" style={{ cursor: "default" }}>
            {Icon.info()}
            <span className="small">Passkeys on Android are kept by Google Password Manager and can sync to your other signed-in devices. Your words and cards don't: they stay on this phone.</span>
          </div>
          {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
          <button type="button" className="btn" disabled={busy} onClick={turnOn}>
            {busy ? "Waiting for your phone…" : "Turn it on"}
          </button>
          <button type="button" className="btn second" onClick={() => made.current && onDone(made.current.unlocked, made.current.envelope)}>
            Not now
          </button>
        </>
      )}
    </div>
  );
}

/** Each time Album opens: fingerprint or face if set up, otherwise the passcode. Or start again from the words. */
export function LockedScreen({ envelope, onOpen, onStartAgain }: { envelope: Stored; onOpen: (unlocked: Unlocked) => void; onStartAgain: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const tried = useRef(false);
  const passkey = envelope.v === 2 ? envelope.passkey : undefined;

  const withPasskey = async () => {
    if (envelope.v !== 2 || !envelope.passkey) return;
    setBusy(true);
    setProblem(null);
    const output = await usePasskey(envelope.passkey.id, envelope.passkey.salt);
    if (!output) {
      setBusy(false);
      return setProblem("Not opened. Try again, or use your passcode.");
    }
    try {
      onOpen(await unlockWithPasskey(envelope, output));
    } catch {
      setBusy(false);
      setProblem("That passkey doesn't open this Album. Use your passcode.");
    }
  };
  useEffect(() => {
    // Ask for the fingerprint or face as soon as Album opens. If the browser wants a tap first, the button is there.
    if (passkey && !tried.current) {
      tried.current = true;
      withPasskey();
    }
  }, [passkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const unlock = async () => {
    setBusy(true);
    try {
      onOpen(await unlockVault(envelope, pass));
    } catch {
      setProblem("That passcode doesn't open this Album.");
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <h1 className="h1">Album</h1>
      {passkey && (
        <button type="button" className="btn" disabled={busy} onClick={withPasskey}>
          Open with fingerprint or face
        </button>
      )}
      <form className="stack" onSubmit={(event) => { event.preventDefault(); if (pass && !busy) unlock(); }}>
        <div className="field">
          <label htmlFor="unlock">{passkey ? "Or your passcode" : "Passcode"}</label>
          <input id="unlock" className="input" type="password" autoComplete="current-password" autoFocus={!passkey} value={pass} onChange={(event) => { setPass(event.target.value); setProblem(null); }} />
        </div>
        {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
        <button type="submit" className={passkey ? "btn second" : "btn"} disabled={busy || !pass}>
          {busy ? "Opening…" : "Open"}
        </button>
      </form>
      {!forgot ? (
        <button type="button" className="btn danger" style={{ color: "#16181D" }} onClick={() => setForgot(true)}>
          Forgot your passcode?
        </button>
      ) : (
        <div className="badbox" style={{ flexDirection: "column" }}>
          <strong>Start again with your recovery words?</strong>
          <span>The cards on this phone are wiped. Your words bring every card key back, and a backup file brings the cards back.</span>
          <div className="row">
            <button type="button" className="btn small" style={{ background: "#A3111D", width: "auto" }} onClick={onStartAgain}>
              Start again
            </button>
            <button type="button" className="btn small second" style={{ width: "auto" }} onClick={() => setForgot(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
