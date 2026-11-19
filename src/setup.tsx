import { useMemo, useState } from "react";
import type { HolderState } from "./engine/schema";
import { cleanWords, createVault, newWords, unlockVault, wordsValid, type Envelope, type Unlocked } from "./vault";
import { Icon } from "./ui";

const MIN_PASSCODE = 6;

/** First run: make or type the recovery words, then choose a passcode. */
export function SetupScreen({ carry, onDone }: { carry: HolderState; onDone: (unlocked: Unlocked, envelope: Envelope) => void }) {
  const [step, setStep] = useState<"choose" | "show" | "check" | "restore" | "passcode">("choose");
  const [words, setWords] = useState("");
  const [typed, setTyped] = useState("");
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [problem, setProblem] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const positions = useMemo(() => {
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(crypto.getRandomValues(new Uint32Array(1))[0] % 12);
    return [...picked].sort((a, b) => a - b);
  }, [words]); // A fresh choice each time new words are made.

  const make = () => {
    setWords(newWords());
    setStep("show");
  };
  const check = () => {
    const list = words.split(" ");
    if (positions.every((position, i) => answers[i].trim().toLowerCase() === list[position])) {
      setProblem(null);
      setStep("passcode");
    } else setProblem("Those don't match. Look at your paper again.");
  };
  const restore = () => {
    if (!wordsValid(typed)) return setProblem("Those aren't 12 recovery words. Check each word and the order.");
    setProblem(null);
    setWords(cleanWords(typed));
    setStep("passcode");
  };
  const finish = async () => {
    if (pass.length < MIN_PASSCODE) return setProblem("Use at least " + MIN_PASSCODE + " characters.");
    if (pass !== again) return setProblem("The two passcodes don't match.");
    setProblem(null);
    setBusy(true);
    try {
      const { unlocked, envelope } = await createVault(words, pass, carry);
      onDone(unlocked, envelope);
    } catch {
      setBusy(false);
      setProblem("Album couldn't lock itself on this phone. Try again.");
    }
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
          <button type="button" className="btn" onClick={make}>
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
          <p className="small">On paper, in this order. Don't take a photo or a screenshot.</p>
          <ol className="words" aria-label="Your recovery words">
            {words.split(" ").map((word, index) => (
              <li key={index}>{word}</li>
            ))}
          </ol>
          <div className="know" style={{ cursor: "default" }}>
            {Icon.info()}
            <span className="small">Anyone with these words can make your card keys. Lose them and your phone, and your cards can never be proved yours again.</span>
          </div>
          <button type="button" className="btn" onClick={() => { setAnswers(["", "", ""]); setProblem(null); setStep("check"); }}>
            I've written them down
          </button>
        </>
      )}

      {step === "check" && (
        <>
          <h1 className="h1 sm">Check your paper</h1>
          <p className="small">Type these three words from it.</p>
          {positions.map((position, i) => (
            <div key={position} className="field">
              <label htmlFor={"w" + position}>Word {position + 1}</label>
              <input
                id={"w" + position}
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={answers[i]}
                onChange={(event) => setAnswers(answers.map((a, j) => (j === i ? event.target.value : a)))}
              />
            </div>
          ))}
          {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
          <button type="button" className="btn" disabled={answers.some((a) => !a.trim())} onClick={check}>
            Check
          </button>
          <button type="button" className="btn second" onClick={() => setStep("show")}>
            See the words again
          </button>
        </>
      )}

      {step === "restore" && (
        <>
          <h1 className="h1 sm">Type your recovery words</h1>
          <p className="small">All 12, in order, with spaces between.</p>
          <div className="field">
            <label htmlFor="restore">Recovery words</label>
            <textarea id="restore" className="input" autoComplete="off" autoCapitalize="none" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
          </div>
          {problem && <p className="small" style={{ color: "#A3111D" }} role="alert">{problem}</p>}
          <button type="button" className="btn" disabled={!typed.trim()} onClick={restore}>
            Continue
          </button>
          <button type="button" className="btn second" onClick={() => setStep("choose")}>
            Back
          </button>
        </>
      )}

      {step === "passcode" && (
        <>
          <h1 className="h1 sm">Choose a passcode</h1>
          <p className="small">Album asks for it each time it opens. It keeps your cards and words locked on this phone. If you forget it, your recovery words start Album again.</p>
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
    </div>
  );
}

/** Each time Album opens: the passcode, or start again from the recovery words. */
export function LockedScreen({ envelope, onOpen, onStartAgain }: { envelope: Envelope; onOpen: (unlocked: Unlocked) => void; onStartAgain: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [forgot, setForgot] = useState(false);
  const unlock = async () => {
    setBusy(true);
    try {
      onOpen(await unlockVault(envelope, pass));
    } catch {
      setWrong(true);
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <h1 className="h1">Album</h1>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (pass && !busy) unlock();
        }}
      >
        <div className="field">
          <label htmlFor="unlock">Passcode</label>
          <input id="unlock" className="input" type="password" autoComplete="current-password" autoFocus value={pass} onChange={(event) => { setPass(event.target.value); setWrong(false); }} />
        </div>
        {wrong && <p className="small" style={{ color: "#A3111D" }} role="alert">That passcode doesn't open this Album.</p>}
        <button type="submit" className="btn" disabled={busy || !pass}>
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
