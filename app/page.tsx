"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import vocabularyData from "../chinese_vocab.json";

type VocabularyCard = {
  id: string;
  chinese: string;
  english: string;
};

type CardStatus = "known" | "unknown";
type ReviewMode = "all" | "unknown";
type SlideDirection = "next" | "previous";
type ChineseFont = "sans" | "kai";
type JsonVocabularyCard = {
  id: number;
  word: string;
};

const STORAGE_KEY = "chinese-learner-card-status-v1";
const MARK_ADVANCE_DELAY_MS = 450;

const jsonCards: VocabularyCard[] = (vocabularyData.cards as JsonVocabularyCard[]).map((card) => ({
  id: `json-${card.id}`,
  chinese: card.word,
  english: ""
}));

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function cardId(card: Omit<VocabularyCard, "id">, index: number) {
  return `${card.chinese}-${card.english}-${index}`;
}

function rowsToCards(rows: Record<string, unknown>[]) {
  return rows
    .map((row, index) => {
      const normalized = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? "").trim()])
      );
      const card = {
        chinese: normalized.chinese ?? "",
        english: normalized.english ?? ""
      };

      if (!card.chinese && !card.english) {
        return null;
      }

      return {
        id: cardId(card, index),
        ...card
      };
    })
    .filter((card): card is VocabularyCard => Boolean(card?.chinese));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function tableToObjects(table: unknown[][]) {
  const [headerRow, ...dataRows] = table;
  const headers = headerRow?.map((value) => String(value ?? "")) ?? [];

  return dataRows.map((dataRow) =>
    Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""]))
  );
}

function readWorkbook(file: File) {
  return new Promise<VocabularyCard[]>((resolve, reject) => {
    if (file.name.toLowerCase().endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = () => {
        const table = parseCsv(String(reader.result ?? ""));
        resolve(rowsToCards(tableToObjects(table)));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
      return;
    }

    readSheet(file)
      .then((table) => {
        resolve(rowsToCards(tableToObjects(table)));
      })
      .catch((error: unknown) => {
        reject(error);
      });
  });
}

export default function Home() {
  const [cards, setCards] = useState<VocabularyCard[]>(jsonCards);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [reviewMode, setReviewMode] = useState<ReviewMode>("all");
  const [slideDirection, setSlideDirection] = useState<SlideDirection>("next");
  const [chineseFont, setChineseFont] = useState<ChineseFont>("kai");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [canSpeak, setCanSpeak] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setStatuses(JSON.parse(stored));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
  }, [statuses]);

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    setCanSpeak(true);

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  const visibleCards = useMemo(() => {
    if (reviewMode === "unknown") {
      return cards.filter((card) => statuses[card.id] === "unknown");
    }
    return cards;
  }, [cards, reviewMode, statuses]);

  const currentCard = visibleCards[currentIndex] ?? null;
  const knownCount = cards.filter((card) => statuses[card.id] === "known").length;
  const unknownCount = cards.filter((card) => statuses[card.id] === "unknown").length;

  const goToCard = useCallback(
    (direction: "previous" | "next") => {
      setSlideDirection(direction);
      setCurrentIndex((index) => {
        if (visibleCards.length === 0) {
          return 0;
        }
        const offset = direction === "next" ? 1 : -1;
        return (index + offset + visibleCards.length) % visibleCards.length;
      });
    },
    [visibleCards.length]
  );

  const markCard = useCallback((status: CardStatus) => {
    setStatuses((current) => {
      if (!currentCard) {
        return current;
      }
      return { ...current, [currentCard.id]: status };
    });

    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
    }

    advanceTimeoutRef.current = setTimeout(() => {
      goToCard("next");
      advanceTimeoutRef.current = null;
    }, MARK_ADVANCE_DELAY_MS);
  }, [currentCard, goToCard]);

  const jumpToCard = useCallback(() => {
    const pageNumber = Number(jumpValue);

    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > visibleCards.length) {
      return;
    }

    setSlideDirection(pageNumber - 1 >= currentIndex ? "next" : "previous");
    setCurrentIndex(pageNumber - 1);
    setJumpValue("");
  }, [currentIndex, jumpValue, visibleCards.length]);

  const speakCurrentCard = useCallback(() => {
    if (!currentCard || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(currentCard.chinese);
    utterance.lang = "zh-TW";
    utterance.rate = 0.82;
    utterance.pitch = 1;
    utterance.voice =
      voices.find((voice) => voice.lang.toLowerCase() === "zh-tw") ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ??
      null;

    window.speechSynthesis.speak(utterance);
  }, [currentCard, voices]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [reviewMode, cards]);

  useEffect(() => {
    if (currentIndex >= visibleCards.length) {
      setCurrentIndex(Math.max(visibleCards.length - 1, 0));
    }
  }, [currentIndex, visibleCards.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "ArrowRight") {
        goToCard("next");
      }
      if (event.key === "ArrowLeft") {
        goToCard("previous");
      }
      if (event.key.toLowerCase() === "k") {
        markCard("known");
      }
      if (event.key.toLowerCase() === "u") {
        markCard("unknown");
      }
      if (event.key.toLowerCase() === "s") {
        speakCurrentCard();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToCard, markCard, speakCurrentCard]);

  async function handleUpload(file: File | null) {
    if (!file) {
      return;
    }

    setError("");
    const parsedCards = await readWorkbook(file);

    if (parsedCards.length === 0) {
      setError("No rows found. Use columns named Chinese and English.");
      return;
    }

    setCards(parsedCards);
    setSlideDirection("next");
    setCurrentIndex(0);
  }

  const currentStatus = currentCard ? statuses[currentCard.id] : undefined;

  return (
    <main className="min-h-screen overflow-hidden px-3 py-3 text-stone-950 sm:px-4 sm:py-4 md:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-7xl flex-col sm:min-h-[calc(100vh-2rem)]">
        <header className="flex flex-col gap-3 rounded-md border border-stone-200 bg-white/85 px-3 py-3 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between md:px-4">
          <div className="flex items-center justify-between gap-3">
            <button
              className="h-10 shrink-0 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold shadow-sm transition hover:border-stone-400 hover:bg-stone-50 sm:px-4"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
            />
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-stone-600">
              <span>{cards.length} cards</span>
              <span className="h-1 w-1 rounded-full bg-stone-300" />
              <span className="text-green-700">{knownCount} ✓</span>
              <span className="text-red-700">{unknownCount} ×</span>
            </div>
          </div>

          <div className="flex w-full gap-2 overflow-x-auto pb-1 md:w-auto md:justify-end md:overflow-visible md:pb-0">
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1">
              <button
                className={`h-9 rounded-md px-3 text-sm font-semibold transition sm:px-4 ${
                  chineseFont === "sans" ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white"
                }`}
                aria-label="Use original font"
                onClick={() => setChineseFont("sans")}
              >
                Original
              </button>
              <button
                className={`h-9 rounded-md px-3 text-sm font-semibold transition sm:px-4 ${
                  chineseFont === "kai" ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white"
                }`}
                aria-label="Use Kai font"
                onClick={() => setChineseFont("kai")}
              >
                楷書
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-stone-100 p-1">
            <button
              className={`h-9 rounded-md px-3 text-sm font-semibold transition sm:px-4 ${
                reviewMode === "all" ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white"
              }`}
              aria-label="Show all cards"
              onClick={() => setReviewMode("all")}
            >
              All
            </button>
            <button
              className={`h-9 rounded-md px-3 text-sm font-semibold transition sm:px-4 ${
                reviewMode === "unknown" ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white"
              }`}
              aria-label="Show unknown cards"
              onClick={() => setReviewMode("unknown")}
            >
              Unknown
            </button>
            </div>
          </div>
        </header>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}

        <div className="grid flex-1 place-items-center py-3 sm:py-5 md:py-8">
          {currentCard ? (
            <div className="slideshow-stage w-full max-w-6xl">
              <article
                key={`${currentCard.id}-${slideDirection}`}
                className={`flip-card flex min-h-[54vh] w-full flex-col items-center justify-center rounded-md border border-stone-200 bg-white/92 px-3 py-6 text-center shadow-[0_18px_58px_rgba(31,25,17,0.10)] transition-all duration-150 ease-crisp sm:min-h-[58vh] sm:px-4 sm:py-8 md:min-h-[66vh] md:px-8 md:shadow-[0_22px_80px_rgba(31,25,17,0.12)] ${
                  slideDirection === "next" ? "flip-card-next" : "flip-card-previous"
                }`}
              >
                <div className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 sm:mb-6 sm:text-sm">
                  {currentIndex + 1} / {visibleCards.length}
                </div>
                <button
                  className="mb-4 grid size-9 place-items-center rounded-full border border-stone-200 bg-white/80 text-stone-500 shadow-sm transition hover:scale-105 hover:border-stone-300 hover:bg-white hover:text-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 sm:mb-5 sm:size-10"
                  aria-label="Play Chinese audio"
                  disabled={!canSpeak}
                  onClick={speakCurrentCard}
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 sm:h-5 sm:w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
                    <path d="M16 9.5a4 4 0 0 1 0 5" />
                    <path d="M18.5 7a7.5 7.5 0 0 1 0 10" />
                  </svg>
                </button>
                <h1
                  className={`max-w-full break-words text-[6rem] font-semibold leading-none tracking-normal text-stone-950 sm:text-[8rem] md:text-[11rem] lg:text-[13rem] ${
                    chineseFont === "kai" ? "font-kai" : ""
                  }`}
                  style={{ fontSize: "clamp(4.5rem, 24vw, 13rem)" }}
                >
                  {currentCard.chinese}
                </h1>
                {currentCard.english ? (
                  <p className="mt-6 max-w-3xl text-xl text-stone-600 sm:text-2xl md:mt-8 md:text-4xl">{currentCard.english}</p>
                ) : null}

                <div className="mt-8 flex flex-wrap justify-center gap-4 sm:mt-10">
                  <button
                    className={`grid size-14 place-items-center rounded-full text-3xl font-bold shadow-sm ring-4 ring-white transition hover:scale-105 active:scale-95 sm:size-16 sm:text-4xl ${
                      currentStatus === "unknown"
                        ? "bg-red-600 text-white shadow-red-900/20"
                        : "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                    }`}
                    aria-label="Mark current card unknown"
                    onClick={() => markCard("unknown")}
                  >
                    ×
                  </button>
                  <button
                    className={`grid size-14 place-items-center rounded-full text-3xl font-bold shadow-sm ring-4 ring-white transition hover:scale-105 active:scale-95 sm:size-16 sm:text-4xl ${
                      currentStatus === "known"
                        ? "bg-green-600 text-white shadow-green-900/20"
                        : "border border-green-200 bg-white text-green-600 hover:bg-green-50"
                    }`}
                    aria-label="Mark current card known"
                    onClick={() => markCard("known")}
                  >
                    ✓
                  </button>
                </div>
              </article>
            </div>
          ) : (
            <div className="rounded-md border border-stone-200 bg-white/85 px-8 py-12 text-center shadow-sm">
              <h1 className="text-5xl font-semibold text-stone-950">No unknown cards</h1>
              <p className="mt-4 text-xl text-stone-600">Switch back to All to keep reviewing.</p>
            </div>
          )}
        </div>

        <footer className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md border border-stone-200 bg-white/75 p-2 shadow-sm backdrop-blur sm:grid-cols-[7rem_minmax(0,1fr)_7rem] sm:p-3">
          <button
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-2xl font-semibold shadow-sm transition hover:-translate-x-0.5 hover:border-stone-400 hover:bg-stone-50 active:translate-x-0 sm:h-12 sm:px-5"
            aria-label="Previous card"
            onClick={() => goToCard("previous")}
          >
            ←
          </button>
          <div className="mx-auto flex max-w-full items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-1 shadow-sm sm:gap-2 sm:px-2">
            <input
              className="h-10 w-14 rounded-md border border-stone-300 bg-white px-2 text-center text-base font-semibold text-stone-950 outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10 sm:w-16"
              aria-label="Jump to card number"
              inputMode="numeric"
              placeholder={`${currentIndex + 1}`}
              pattern="[0-9]*"
              type="text"
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  jumpToCard();
                }
              }}
            />
            <span className="hidden text-sm font-semibold text-stone-500 sm:inline">/ {visibleCards.length}</span>
            <button
              className="h-10 rounded-md bg-stone-950 px-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 sm:px-3"
              disabled={visibleCards.length === 0}
              onClick={jumpToCard}
            >
              Jump
            </button>
          </div>
          <button
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-2xl font-semibold shadow-sm transition hover:translate-x-0.5 hover:border-stone-400 hover:bg-stone-50 active:translate-x-0 sm:h-12 sm:px-5"
            aria-label="Next card"
            onClick={() => goToCard("next")}
          >
            →
          </button>
        </footer>
      </section>
    </main>
  );
}
