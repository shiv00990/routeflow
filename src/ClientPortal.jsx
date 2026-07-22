import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import L from 'leaflet';

export default function ClientPortal({ tripId }) {
  const [itinerary, setItinerary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ days: '00', hours: '00', mins: '00', secs: '00' });
  const [liveWeather, setLiveWeather] = useState('Loading weather...');
  
  const [visitedActivities, setVisitedActivities] = useState({});
  const [activeTarget, setActiveTarget] = useState(null);
  const [userCoords, setUserCoords] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [audioPlayer, setAudioPlayer] = useState(null);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarkerRef = useRef(null);
  const activeRouteLayerRef = useRef(null);
  const targetMarkerRef = useRef(null);

  const localFallbackImage = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80";

  // 1. Fetch Trip Data from Supabase
  useEffect(() => {
    async function fetchTrip() {
      const { data, error } = await supabase.from('itineraries').select('*').eq('id', tripId).single();
      if (!error && data) {
        setItinerary(data);
        fetchLiveWeather(data.destination);
      }
      setLoading(false);
    }
    fetchTrip();
  }, [tripId]);

  // 2. Safely Initialize Map Container
  useEffect(() => {
    if (loading || !itinerary || !mapRef.current || mapInstance.current) return;

    const initMap = async () => {
      let startLat = 9.9252, startLng = 78.1198, zoomLevel = 12;

      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(itinerary.destination)}&count=1&format=json`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          startLat = data.results[0].latitude;
          startLng = data.results[0].longitude;
        }
      } catch (e) {
        console.error("Geocoding failed", e);
      }

      if (!mapInstance.current && mapRef.current) {
        mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([startLat, startLng], zoomLevel);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(mapInstance.current);

        setTimeout(() => {
          if (mapInstance.current) mapInstance.current.invalidateSize();
        }, 200);
      }
    };

    initMap();
  }, [loading, itinerary]);

  // 3. Scan Across ALL Days for the First Unvisited Stop
  useEffect(() => {
    if (!itinerary) return;

    let nextTarget = null;
    itinerary.trip_data?.forEach((day, dIdx) => {
      day.activities?.forEach((act, aIdx) => {
        const key = `${dIdx}-${aIdx}`;
        if (!visitedActivities[key] && !nextTarget && act.lat && act.lng) {
          nextTarget = { ...act, key, dIdx, aIdx, dayTitle: day.dayTitle };
        }
      });
    });

    setActiveTarget(nextTarget);
  }, [itinerary, visitedActivities]);

  // 4. Watch Live User GPS Coordinates
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const currentLoc = [latitude, longitude];
        setUserCoords(currentLoc);

        if (mapInstance.current) {
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng(currentLoc);
          } else {
            const userIcon = L.divIcon({
              className: 'bg-blue-600 w-4 h-4 rounded-full ring-4 ring-white shadow-lg animate-pulse',
              iconSize: [16, 16]
            });
            userMarkerRef.current = L.marker(currentLoc, { icon: userIcon })
              .addTo(mapInstance.current)
              .bindPopup("Your Location");
          }
        }
      },
      (err) => console.log("Awaiting GPS location..."),
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 5. Render Target Pin & Dynamic Popup Title + Draw Route Lines Across Days
  useEffect(() => {
    if (!mapInstance.current || !activeTarget) return;

    const targetCoords = [activeTarget.lat, activeTarget.lng];

    if (targetMarkerRef.current) {
      targetMarkerRef.current
        .setLatLng(targetCoords)
        .setPopupContent(`<b>Target:</b> ${activeTarget.title}`)
        .openPopup();
    } else {
      // Create and add destination pin marker to map
      const flagIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="
            width: 32px; 
            height: 32px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.3));
          ">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" stroke="#ffffff" stroke-width="1.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5" fill="#ffffff"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      targetMarkerRef.current = L.marker(targetCoords, { icon: flagIcon })
        .addTo(mapInstance.current)
        .bindPopup(`<b>Target:</b> ${activeTarget.title}`)
        .openPopup();
    }

    if (activeRouteLayerRef.current) {
      mapInstance.current.removeLayer(activeRouteLayerRef.current);
      activeRouteLayerRef.current = null;
    }

    if (userCoords) {
      if (!itinerary?.is_driving_route) {
        activeRouteLayerRef.current = L.polyline([userCoords, targetCoords], {
          color: '#2563eb',
          weight: 4,
          dashArray: '8, 12',
          opacity: 0.8
        }).addTo(mapInstance.current);

        mapInstance.current.fitBounds([userCoords, targetCoords], { padding: [50, 50] });
      } else {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${userCoords[1]},${userCoords[0]};${targetCoords[1]},${targetCoords[0]}?overview=full&geometries=geojson`;

        fetch(osrmUrl)
          .then((res) => res.json())
          .then((data) => {
            if (data.routes && data.routes.length > 0) {
              const coordinates = data.routes[0].geometry.coordinates.map((coord) => [coord[1], coord[0]]);
              
              if (activeRouteLayerRef.current) {
                mapInstance.current.removeLayer(activeRouteLayerRef.current);
              }

              activeRouteLayerRef.current = L.polyline(coordinates, {
                color: '#1d4ed8',
                weight: 5,
                opacity: 0.9,
                lineJoin: 'round'
              }).addTo(mapInstance.current);

              mapInstance.current.fitBounds(activeRouteLayerRef.current.getBounds(), { padding: [40, 40] });
            }
          })
          .catch(() => {
            activeRouteLayerRef.current = L.polyline([userCoords, targetCoords], {
              color: '#1d4ed8', weight: 4, dashArray: '6, 6'
            }).addTo(mapInstance.current);
          });
      }
    } else {
      mapInstance.current.setView(targetCoords, 14);
    }
  }, [activeTarget, userCoords, itinerary]);

  // Voice Assistant Handler
  const triggerVoiceGuide = async (text) => {
    if (speaking) {
      if (audioPlayer) audioPlayer.pause();
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    if (!text) return;

    setSpeaking(true);

    const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; 
    const ELEVENLABS_API_KEY = 'sk_2bf8e5aacecd132be94f7fdc84c7e8c60f2e1c9461598e1d';

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API response error: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      setAudioPlayer(audio);
      audio.play();

      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);

    } catch (err) {
      console.warn("ElevenLabs request failed. Falling back to native browser voice engine...", err);

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();

      const bestVoice = voices.find(v => 
        (v.name.includes('Samantha') || v.name.includes('Google') || v.name.includes('Natural')) && 
        v.lang.startsWith('en')
      ) || voices.find(v => v.lang.startsWith('en'));

      if (bestVoice) utterance.voice = bestVoice;
      utterance.rate = 0.92;
      utterance.pitch = 1.05;

      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  const handleVisitOver = (key) => {
    if (audioPlayer) audioPlayer.pause();
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setVisitedActivities((prev) => ({ ...prev, [key]: true }));
  };

  async function fetchLiveWeather(locationName) {
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&format=json`);
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) return;
      const { latitude, longitude } = geoData.results[0];
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
      const weatherData = await weatherRes.json();
      if (weatherData.current_weather) {
        setLiveWeather(`Clear, ${Math.round(weatherData.current_weather.temperature)}°C`);
      }
    } catch (err) { console.error(err); }
  }

  useEffect(() => {
    if (!itinerary || !itinerary.departure_date) return;
    const interval = setInterval(() => {
      const targetTime = new Date(`${itinerary.departure_date}T00:00:00`).getTime();
      const distance = targetTime - new Date().getTime();
      if (distance < 0) {
        setCountdown({ days: '00', hours: '00', mins: '00', secs: '00', isExpired: true });
        clearInterval(interval);
      } else {
        const d = Math.floor(distance / (1000 * 60 * 60 * 24));
        const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        setCountdown({
          days: d < 10 ? `0${d}` : `${d}`, hours: h < 10 ? `0${h}` : `${h}`,
          mins: m < 10 ? `0${m}` : `${m}`, secs: s < 10 ? `0${s}` : `${s}`,
          isExpired: false
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [itinerary]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#FAFAFA] text-slate-800">Loading Portal...</div>;
  if (!itinerary) return <div className="h-screen flex items-center justify-center bg-[#FAFAFA]">Itinerary Offline.</div>;

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-[#FAFAFA] flex flex-col relative shadow-2xl overflow-hidden text-slate-900 font-sans antialiased">
      
      {/* 1. Header Banner */}
      <div className="h-[30vh] w-full relative overflow-hidden bg-slate-900 shrink-0 z-10">
        <img src={itinerary.cover_image || localFallbackImage} alt={itinerary.destination} className="w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
        
        {/* Countdown Card */}
        <div className="absolute bottom-4 left-6 right-6 bg-white/10 backdrop-blur-xl border border-white/20 px-5 py-3.5 rounded-2xl text-center shadow-xl">
          <p className="text-[9px] font-bold text-amber-300 tracking-widest font-mono uppercase mb-1">Adventure Commences In</p>
          {countdown.isExpired ? (
            <p className="text-lg font-bold text-white tracking-wide font-mono">TRIP ACTIVE 🚀</p>
          ) : (
            <div className="flex justify-center items-center gap-3 font-mono text-white text-xl font-bold">
              <div><span>{countdown.days}</span><span className="text-[8px] text-slate-300 block font-sans uppercase font-normal">Days</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span>{countdown.hours}</span><span className="text-[8px] text-slate-300 block font-sans uppercase font-normal">Hrs</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span>{countdown.mins}</span><span className="text-[8px] text-slate-300 block font-sans uppercase font-normal">Mins</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span className="text-amber-300">{countdown.secs}</span><span className="text-[8px] text-amber-300/80 block font-sans uppercase font-normal">Secs</span></div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Smooth Scrollable Container */}
      <div className="flex-1 overflow-y-auto scroll-smooth px-5 pt-5 pb-24 space-y-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        
        {/* Title Block */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 font-mono">Bespoke Portal</span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 leading-tight">{itinerary.destination.toUpperCase()}</h1>
          <p className="text-xs text-slate-500">Curated for <span className="font-semibold text-slate-800">{itinerary.client_name}</span></p>
        </div>

        {/* Map Card */}
        <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-200/70 space-y-2">
          <div className="flex justify-between items-center px-1">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase font-mono">Live Navigation Path</span>
              {activeTarget ? (
                <span className="text-[11px] text-blue-600 font-semibold font-mono truncate max-w-[200px]">📍 {activeTarget.title}</span>
              ) : (
                <span className="text-[11px] text-emerald-600 font-semibold font-mono">🎉 All Visits Completed!</span>
              )}
            </div>
            <span className="text-[10px] px-2.5 py-0.5 bg-slate-100 rounded-full text-slate-700 font-medium font-mono">🌤️ {liveWeather}</span>
          </div>
          
          <div className="w-full h-52 rounded-xl overflow-hidden relative z-0 border border-slate-100 bg-slate-100">
            <div ref={mapRef} className="w-full h-full" style={{ height: '100%', width: '100%' }} />
          </div>
        </div>

        {/* MULTI-DAY LOOP */}
        {itinerary.trip_data?.map((day, dayIndex) => (
          <div key={dayIndex} className="pt-2">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider sticky top-0 bg-[#FAFAFA]/90 backdrop-blur-md py-2 z-10 font-mono border-b border-slate-200/60 mb-3">
              {day.dayTitle}
            </h2>

            <div className="space-y-3.5 pl-1">
              {day.activities?.map((act, actIndex) => {
                const key = `${dayIndex}-${actIndex}`;
                const isCurrentActiveTarget = activeTarget?.key === key;
                const isVisited = visitedActivities[key];

                return (
                  <div key={actIndex} className={`transition-all duration-300 ${isVisited ? 'opacity-40' : 'opacity-100'}`}>
                    
                    <div className={`bg-white rounded-2xl p-4 border transition-all ${isCurrentActiveTarget ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-md' : 'border-slate-200/60 shadow-sm'}`}>
                      
                      {act.placeImage && (
                        <img src={act.placeImage} alt={act.title} className="w-full h-28 object-cover rounded-xl mb-3" />
                      )}

                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-amber-700 font-mono">{act.time}</span>
                        
                        <button 
                          onClick={() => triggerVoiceGuide(act.description)}
                          className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-mono transition-colors"
                        >
                          {speaking && isCurrentActiveTarget ? "⏸️ Pause" : "🔊 Voice Guide"}
                        </button>
                      </div>

                      <h3 className="font-semibold text-slate-900 text-sm mb-1">{act.title}</h3>
                      <p className="text-xs text-slate-500 leading-relaxed mb-3">{act.description}</p>

                      {isCurrentActiveTarget && !isVisited && (
                        <button
                          onClick={() => handleVisitOver(key)}
                          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase rounded-xl font-mono transition-all active:scale-95 shadow-sm"
                        >
                          ✓ Visit Over (Show Next Location)
                        </button>
                      )}
                      
                      {isVisited && (
                        <span className="text-[10px] text-emerald-600 font-bold font-mono block">✓ Checked Out / Completed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 3. Sticky Bottom Action Bar */}
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/90 to-transparent z-20">
        <a href="https://wa.me/918008625370" target="_blank" rel="noreferrer" className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-center shadow-lg text-xs tracking-wider uppercase font-mono block transition-colors">
          💬 Connect With Travel Planner
        </a>
      </div>
    </div>
  );
}