import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import playlistData from "./data/playlists.json";
import "./styles.css";

const playlists = Array.isArray(playlistData)
  ? playlistData
  : playlistData.playlists ?? [];

const allSongs = playlists.flatMap((playlist, playlistIndex) =>
  (playlist.songs ?? []).map((song, songIndex) => ({
    ...song,
    sourcePlaylistId: playlist.id,
    sourcePlaylistTitle: playlist.title,
    sourcePlaylistIndex: playlistIndex,
    sourceSongIndex: songIndex,
  })),
);

const mostPlayedSongs = uniqueSongsByBestMatch(
  allSongs.filter((song) => song.playCount !== undefined && song.playCount !== null),
  (candidate, current) => (candidate.playCount ?? 0) > (current.playCount ?? 0),
)
  .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
  .slice(0, 25);

const lastHeardSongs = uniqueSongsByBestMatch(
  allSongs.filter((song) => getDateValue(song.lastPlayed) !== null),
  (candidate, current) => getDateValue(candidate.lastPlayed) > getDateValue(current.lastPlayed),
)
  .sort((a, b) => getDateValue(b.lastPlayed) - getDateValue(a.lastPlayed))
  .slice(0, 25);

const totalPlayCount = allSongs.reduce(
  (total, song) => total + (Number.isFinite(song.playCount) ? song.playCount : 0),
  0,
);

const lastActivityTime = lastHeardSongs.length
  ? getDateValue(lastHeardSongs[0].lastPlayed)
  : null;

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

function getDateValue(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getSongKey(song) {
  return `${song.title || ""}::${song.artist || ""}`.toLowerCase().trim();
}

function uniqueSongsByBestMatch(songs, isBetterMatch) {
  const bySong = new Map();

  songs.forEach((song) => {
    const key = getSongKey(song);
    const current = bySong.get(key);

    if (!current || isBetterMatch(song, current)) {
      bySong.set(key, song);
    }
  });

  return [...bySong.values()];
}

function formatDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatSongCount(count) {
  const value = count ?? 0;
  return `${formatNumber(value)} ${value === 1 ? "song" : "songs"}`;
}

function formatPlayCount(count) {
  if (count === undefined || count === null) return null;
  return `${formatNumber(count)} ${count === 1 ? "play" : "plays"}`;
}

function formatPlayedLine(count) {
  if (count === undefined || count === null) return null;
  return `Played ${formatNumber(count)} ${count === 1 ? "time" : "times"}`;
}

function getPlaylistSubtitle(playlist) {
  return `${formatSongCount(playlist.songs?.length)} from the iPod`;
}

function getTrackDetails(song) {
  if (!song) return [];

  const albumLine = [song.album, song.releaseYear].filter(Boolean).join(" · ");

  return [
    ["Last heard", formatDate(song.lastPlayed)],
    ["From", albumLine],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function App() {
  const [view, setView] = useState("menu");
  const [menuIndex, setMenuIndex] = useState(0);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [songIndex, setSongIndex] = useState(0);
  const [mostPlayedIndex, setMostPlayedIndex] = useState(0);
  const [lastHeardIndex, setLastHeardIndex] = useState(0);
  const [trackSource, setTrackSource] = useState("playlist");
  const [isPlaying, setIsPlaying] = useState(false);
  const [backlightOn, setBacklightOn] = useState(true);
  const backlightTimer = useRef(null);
  const screenBodyRef = useRef(null);
  const selectedItemRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioUnlockedRef = useRef(false);

  const currentPlaylist = playlists[playlistIndex] ?? { title: "", songs: [] };
  const topMenuItems = [
    {
      id: "playlists",
      title: "Playlists",
      subtitle: `${formatNumber(playlists.length)} mixes, exactly as found`,
    },
    {
      id: "mostPlayed",
      title: "Most Played",
      subtitle: "The songs that stayed on repeat",
    },
    {
      id: "lastHeard",
      title: "Last Heard",
      subtitle: "The final tracks this iPod remembers",
    },
    {
      id: "about",
      title: "About This iPod",
      subtitle: "A small snapshot of the time capsule",
    },
  ];

  const trackLists = {
    playlist: currentPlaylist.songs ?? [],
    mostPlayed: mostPlayedSongs,
    lastHeard: lastHeardSongs,
  };
  const currentTrackList = trackLists[trackSource] ?? trackLists.playlist;
  const currentTrackIndex =
    trackSource === "mostPlayed"
      ? mostPlayedIndex
      : trackSource === "lastHeard"
        ? lastHeardIndex
        : songIndex;
  const currentSong = currentTrackList[currentTrackIndex];
  const visibleItems = getVisibleItems(view, topMenuItems, currentPlaylist);
  const selectedIndex = getSelectedIndex(view, {
    menuIndex,
    playlistIndex,
    songIndex,
    mostPlayedIndex,
    lastHeardIndex,
  });

  const wake = () => {
    setBacklightOn(true);
    window.clearTimeout(backlightTimer.current);
    backlightTimer.current = window.setTimeout(
      () => setBacklightOn(false),
      10000,
    );
  };

  const unlockAudio = async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    const context = audioContextRef.current || new AudioContext();
    audioContextRef.current = context;

    if (!audioUnlockedRef.current) {
      const buffer = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      audioUnlockedRef.current = true;
    }

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return context;
      }
    }

    return context;
  };

  const playClickWheelTick = async () => {
    const context = await unlockAudio();
    if (!context || context.state !== "running") return;

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
    if (view === "track") {
      screenBodyRef.current?.scrollTo({ top: 0 });
    }
  }, [view, songIndex, mostPlayedIndex, lastHeardIndex]);

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

    const { currentIndex, maxIndex, setIndex } = getNavigationState();
    if (!setIndex || maxIndex < 0) return;

    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), maxIndex);
    if (nextIndex === currentIndex || nextIndex < 0) return;

    playClickWheelTick();
    setIndex(nextIndex);
  };

  const getNavigationState = () => {
    if (view === "menu") {
      return {
        currentIndex: menuIndex,
        maxIndex: topMenuItems.length - 1,
        setIndex: setMenuIndex,
      };
    }

    if (view === "playlists") {
      return {
        currentIndex: playlistIndex,
        maxIndex: playlists.length - 1,
        setIndex: setPlaylistIndex,
      };
    }

    if (view === "songs" || (view === "track" && trackSource === "playlist")) {
      return {
        currentIndex: songIndex,
        maxIndex: (currentPlaylist.songs ?? []).length - 1,
        setIndex: setSongIndex,
      };
    }

    if (view === "mostPlayed" || (view === "track" && trackSource === "mostPlayed")) {
      return {
        currentIndex: mostPlayedIndex,
        maxIndex: mostPlayedSongs.length - 1,
        setIndex: setMostPlayedIndex,
      };
    }

    if (view === "lastHeard" || (view === "track" && trackSource === "lastHeard")) {
      return {
        currentIndex: lastHeardIndex,
        maxIndex: lastHeardSongs.length - 1,
        setIndex: setLastHeardIndex,
      };
    }

    return { currentIndex: 0, maxIndex: -1, setIndex: null };
  };

  const openTrack = (source) => {
    setTrackSource(source);
    setView("track");
    setIsPlaying(true);
  };

  const select = () => {
    wake();

    if (view === "menu") {
      const selected = topMenuItems[menuIndex];
      if (selected?.id) setView(selected.id);
      return;
    }

    if (view === "playlists") {
      setView("songs");
      setSongIndex(0);
      return;
    }

    if (view === "songs") {
      openTrack("playlist");
      return;
    }

    if (view === "mostPlayed") {
      openTrack("mostPlayed");
      return;
    }

    if (view === "lastHeard") {
      openTrack("lastHeard");
      return;
    }

    if (view === "track") {
      setIsPlaying(true);
    }
  };

  const back = () => {
    wake();

    if (view === "track") {
      setView(
        trackSource === "mostPlayed"
          ? "mostPlayed"
          : trackSource === "lastHeard"
            ? "lastHeard"
            : "songs",
      );
    } else if (view === "songs") {
      setView("playlists");
    } else if (view !== "menu") {
      setView("menu");
    }
  };

  const previous = () => {
    move(-1);
  };

  const next = () => {
    move(1);
  };

  const togglePlay = () => {
    wake();
    setIsPlaying((value) => !value);
  };

  const getItemKey = (item, index) =>
    item.id ||
    `${view}-${item.sourcePlaylistId ?? "playlist"}-${item.sourceSongIndex ?? index}-${item.title}`;

  const getItemSubtitle = (item) => {
    if (view === "menu") return item.subtitle;
    if (view === "playlists") return getPlaylistSubtitle(item);
    if (view === "mostPlayed" || view === "lastHeard") {
      return [item.artist || "Unknown Artist", item.sourcePlaylistTitle]
        .filter(Boolean)
        .join(" · ");
    }
    return item.artist || "Unknown Artist";
  };

  const getItemMeta = (item) => {
    if (view === "songs" || view === "mostPlayed") return formatPlayCount(item.playCount);
    if (view === "lastHeard") return formatDate(item.lastPlayed);
    return null;
  };

  const handleItemClick = (index) => {
    wake();

    if (view === "menu") {
      setMenuIndex(index);
      const selected = topMenuItems[index];
      if (selected?.id) setView(selected.id);
    } else if (view === "playlists") {
      setPlaylistIndex(index);
      setView("songs");
      setSongIndex(0);
    } else if (view === "songs") {
      setSongIndex(index);
      openTrack("playlist");
    } else if (view === "mostPlayed") {
      setMostPlayedIndex(index);
      openTrack("mostPlayed");
    } else if (view === "lastHeard") {
      setLastHeardIndex(index);
      openTrack("lastHeard");
    }
  };

  const headerTitle = getHeaderTitle(view, currentPlaylist, currentSong);
  const screenIntro = getScreenIntro(view);

  return (
    <main className="page-shell" onWheel={wake}>
      <section className="ipod" aria-label="Music player interface">
        <div className="ipod-top-shine" />
        <div className={`screen ${backlightOn ? "screen-on" : "screen-dim"}`}>
          <ScreenHeader title={headerTitle} />
          <div className="screen-body" ref={screenBodyRef}>
            {view === "track" ? (
              <TrackDetails song={currentSong} isPlaying={isPlaying} />
            ) : view === "about" ? (
              <AboutScreen />
            ) : (
              <>
                {screenIntro ? <p className="screen-intro">{screenIntro}</p> : null}
                <ul className="menu-list">
                  {visibleItems.map((item, index) => {
                    const meta = getItemMeta(item);

                    return (
                      <li
                        key={getItemKey(item, index)}
                        ref={index === selectedIndex ? selectedItemRef : null}
                        className={index === selectedIndex ? "selected" : ""}
                        onClick={() => handleItemClick(index)}
                      >
                        <div>
                          <strong>{item.title}</strong>
                          <small>{getItemSubtitle(item)}</small>
                        </div>
                        {meta ? <span className="meta">{meta}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>

        <ClickWheel
          onMove={move}
          onMenu={back}
          onSelect={select}
          onPrevious={previous}
          onNext={next}
          onPlayPause={togglePlay}
          onPrimeAudio={unlockAudio}
        />
      </section>
    </main>
  );
}

function getVisibleItems(view, topMenuItems, currentPlaylist) {
  if (view === "menu") return topMenuItems;
  if (view === "playlists") return playlists;
  if (view === "songs") return currentPlaylist.songs ?? [];
  if (view === "mostPlayed") return mostPlayedSongs;
  if (view === "lastHeard") return lastHeardSongs;
  return [];
}

function getSelectedIndex(
  view,
  { menuIndex, playlistIndex, songIndex, mostPlayedIndex, lastHeardIndex },
) {
  if (view === "menu") return menuIndex;
  if (view === "playlists") return playlistIndex;
  if (view === "songs") return songIndex;
  if (view === "mostPlayed") return mostPlayedIndex;
  if (view === "lastHeard") return lastHeardIndex;
  return -1;
}

function getHeaderTitle(view, currentPlaylist, currentSong) {
  if (view === "menu") return "Time Capsule";
  if (view === "playlists") return "Playlists";
  if (view === "songs") return currentPlaylist.title;
  if (view === "mostPlayed") return "Most Played";
  if (view === "lastHeard") return "Last Heard";
  if (view === "about") return "About This iPod";
  return currentSong?.title ?? "Track";
}

function getScreenIntro(view) {
  if (view === "mostPlayed") return "The songs that stayed on repeat.";
  if (view === "lastHeard") return "The final tracks this iPod remembers.";
  return null;
}

function AboutScreen() {
  const facts = [
    ["Playlists", formatNumber(playlists.length)],
    ["Tracks", formatNumber(allSongs.length)],
    ["Plays remembered", formatNumber(totalPlayCount)],
    ["Last track date", formatDate(lastActivityTime)],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return (
    <section className="track-detail">
      <div className="track-hero">
        <span className="now-playing">Found Object</span>
        <h2>An old iPod, years later.</h2>
        <p>A small visual time capsule built from the playlists and listening history it still remembers.</p>
      </div>

      <dl className="track-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TrackDetails({ song, isPlaying }) {
  if (!song) {
    return <p className="empty-state">No track selected.</p>;
  }

  const details = getTrackDetails(song);

  return (
    <section className="track-detail">
      <div className="track-hero">
        <span className="now-playing">{isPlaying ? "Now Playing" : "Paused"}</span>
        <h2>{song.title}</h2>
        <p>{song.artist || "Unknown Artist"}</p>
        {formatPlayedLine(song.playCount) ? (
          <p className="memory-line">{formatPlayedLine(song.playCount)}</p>
        ) : null}
      </div>

      <dl className="track-facts">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
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
  onPrimeAudio,
}) {
  const wheelRef = useRef(null);
  const tracking = useRef({ active: false, angle: 0, accumulated: 0 });

  const startTracking = (event) => {
    onPrimeAudio();
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
        <svg className="skip-icon" viewBox="0 0 30 14" aria-hidden="true" focusable="false">
          <rect x="2" y="1" width="2.6" height="12" rx="1" />
          <path d="M5 7 15 1 15 13Z" />
          <path d="M15 7 25 1 25 13Z" />
        </svg>
      </button>
      <button className="wheel-button next" onClick={onNext} aria-label="next">
        <svg className="skip-icon" viewBox="0 0 30 14" aria-hidden="true" focusable="false">
          <path d="M5 1 15 7 5 13Z" />
          <path d="M15 1 25 7 15 13Z" />
          <rect x="25.4" y="1" width="2.6" height="12" rx="1" />
        </svg>
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
