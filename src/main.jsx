import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import playlists from "./data/playlists.json";
import "./styles.css";

function angleFromPointer(event, element) {
  const rect = element.getBoundingClientRect();
  const clientX = event.touches?.[0]?.clientX ?? event.clientX;
  const clientY = event.touches?.[0]?.clientY ?? event.clientY;
  const x = clientX - (rect.left + rect.width / 2);
  const y = clientY - (rect.top + rect.height / 2);
  return Math.atan2(y, x) * (180 / Math.PI);
}

function normalizeDelta(delta) {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function App() {
  const [view, setView] = useState("playlists");
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [songIndex, setSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [backlightOn, setBacklightOn] = useState(true);
  const backlightTimer = useRef(null);
  const screenBodyRef = useRef(null);
  const selectedItemRef = useRef(null);
  const audioContextRef = useRef(null);

  const currentPlaylist = playlists[playlistIndex];
  const visibleItems = view === "playlists" ? playlists : currentPlaylist.songs;
  const selectedIndex = view === "playlists" ? playlistIndex : songIndex;

  const wake = () => {
    setBacklightOn(true);
    window.clearTimeout(backlightTimer.current);
    backlightTimer.current = window.setTimeout(
      () => setBacklightOn(false),
      10000,
    );
  };

  const playClickWheelTick = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const context = audioContextRef.current || new AudioContext();
    audioContextRef.current = context;
    if (context.state === "suspended") context.resume();

    const t = context.currentTime;
    const duration = 0.02;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.12 + Math.random() * 0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    gain.connect(context.destination);

    const bufferSize = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 180);
    }

    const noise = context.createBufferSource();
    const bandpass = context.createBiquadFilter();

    noise.buffer = buffer;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(3200, t);
    bandpass.Q.setValueAtTime(5, t);

    noise.connect(bandpass);
    bandpass.connect(gain);
    noise.start(t);
    noise.stop(t + duration);

    const osc = context.createOscillator();
    const oscGain = context.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(1800, t);
    oscGain.gain.setValueAtTime(0.035, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);

    osc.connect(oscGain);
    oscGain.connect(context.destination);
    osc.start(t);
    osc.stop(t + 0.012);
  };

  useEffect(() => {
    wake();
    return () => window.clearTimeout(backlightTimer.current);
  }, []);

  useEffect(() => {
    const container = screenBodyRef.current;
    const selectedItem = selectedItemRef.current;
    if (!container || !selectedItem) return;

    const containerRect = container.getBoundingClientRect();
    const itemRect = selectedItem.getBoundingClientRect();

    if (itemRect.bottom > containerRect.bottom) {
      container.scrollBy({
        top: itemRect.bottom - containerRect.bottom,
        behavior: "smooth",
      });
    } else if (itemRect.top < containerRect.top) {
      container.scrollBy({
        top: itemRect.top - containerRect.top,
        behavior: "smooth",
      });
    }
  }, [view, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const keyMap = {
        ArrowUp: () => move(-1),
        ArrowDown: () => move(1),
        ArrowLeft: () => previous(),
        ArrowRight: () => next(),
        Enter: () => select(),
        Escape: () => back(),
        " ": () => togglePlay(),
      };
      if (keyMap[event.key]) {
        event.preventDefault();
        keyMap[event.key]();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const move = (direction) => {
    wake();

    const currentIndex = view === "playlists" ? playlistIndex : songIndex;
    const maxIndex =
      view === "playlists" ? playlists.length - 1 : currentPlaylist.songs.length - 1;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), maxIndex);

    if (nextIndex === currentIndex) return;

    playClickWheelTick();
    if (view === "playlists") {
      setPlaylistIndex(nextIndex);
    } else {
      setSongIndex(nextIndex);
    }
  };

  const select = () => {
    wake();
    if (view === "playlists") {
      setView("songs");
      setSongIndex(0);
    } else {
      setIsPlaying(true);
    }
  };

  const back = () => {
    wake();
    if (view === "songs") setView("playlists");
  };

  const previous = () => {
    if (view === "songs") move(-1);
    else move(-1);
  };

  const next = () => {
    if (view === "songs") move(1);
    else move(1);
  };

  const togglePlay = () => {
    wake();
    setIsPlaying((value) => !value);
  };

  return (
    <main className="page-shell">
      <section className="ipod" aria-label="Music player interface">
        <div className="ipod-top-shine" />
        <div className={`screen ${backlightOn ? "screen-on" : "screen-dim"}`}>
          <ScreenHeader
            title={view === "playlists" ? "Playlists" : currentPlaylist.title}
          />
          <div className="screen-body" ref={screenBodyRef}>
            <ul className="menu-list">
              {visibleItems.map((item, index) => (
                <li
                  key={item.id || `${item.title}-${index}`}
                  ref={index === selectedIndex ? selectedItemRef : null}
                  className={index === selectedIndex ? "selected" : ""}
                  onClick={() => {
                    wake();
                    if (view === "playlists") {
                      setPlaylistIndex(index);
                      setView("songs");
                      setSongIndex(0);
                    } else {
                      setSongIndex(index);
                      setIsPlaying(true);
                    }
                  }}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {view === "playlists" ? item.date : item.artist}
                    </small>
                  </div>
                  <span className="meta">
                    {view === "playlists" ? item.songs.length : item.duration}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ClickWheel
          onMove={move}
          onMenu={back}
          onSelect={select}
          onPrevious={previous}
          onNext={next}
          onPlayPause={togglePlay}
        />
      </section>
    </main>
  );
}

function ScreenHeader({ title }) {
  const now = new Date();
  const time = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="screen-header">
      <span className="signal">♫</span>
      <strong>{title}</strong>
      <span className="battery" aria-label="battery indicator">
        <i />
      </span>
      <time>{time}</time>
    </div>
  );
}

function ClickWheel({
  onMove,
  onMenu,
  onSelect,
  onPrevious,
  onNext,
  onPlayPause,
}) {
  const wheelRef = useRef(null);
  const tracking = useRef({ active: false, angle: 0, accumulated: 0 });
  const [spin, setSpin] = useState(0);

  const startTracking = (event) => {
    if (!wheelRef.current) return;
    tracking.current = {
      active: true,
      angle: angleFromPointer(event, wheelRef.current),
      accumulated: 0,
    };
  };

  const track = (event) => {
    if (!tracking.current.active || !wheelRef.current) return;
    event.preventDefault();
    const angle = angleFromPointer(event, wheelRef.current);
    const delta = normalizeDelta(angle - tracking.current.angle);
    tracking.current.angle = angle;
    tracking.current.accumulated += delta;
    setSpin((value) => value + delta);

    if (Math.abs(tracking.current.accumulated) > 12) {
      onMove(tracking.current.accumulated > 0 ? 1 : -1);
      tracking.current.accumulated = 0;
    }
  };

  const stopTracking = () => {
    tracking.current.active = false;
  };

  return (
    <div
      ref={wheelRef}
      className="click-wheel"
      onMouseDown={startTracking}
      onMouseMove={track}
      onMouseUp={stopTracking}
      onMouseLeave={stopTracking}
      onTouchStart={startTracking}
      onTouchMove={track}
      onTouchEnd={stopTracking}
      style={{ "--spin": `${spin}deg` }}
      aria-label="Click wheel. Rotate to browse, use buttons to navigate."
    >
      <button className="wheel-button menu" onClick={onMenu}>
        MENU
      </button>
      <button
        className="wheel-button prev"
        onClick={onPrevious}
        aria-label="previous"
      >
        ⏪
      </button>
      <button className="wheel-button next" onClick={onNext} aria-label="next">
        ⏩
      </button>
      <button
        className="wheel-button play"
        onClick={onPlayPause}
        aria-label="play pause"
      >
        ▶︎Ⅱ
      </button>
      <button
        className="center-button"
        onClick={onSelect}
        aria-label="select"
      />
      <div className="wheel-groove" />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
