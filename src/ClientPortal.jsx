import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import L from 'leaflet';

export default function ClientPortal({ tripId }) {
  const urlParams = new URLSearchParams(window.location.search);
  const userRole = urlParams.get('role') || 'lead';
  const isTripLead = userRole === 'lead';

  const [itinerary, setItinerary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [countdown, setCountdown] = useState({ days: '00', hours: '00', mins: '00', secs: '00' });
  const [liveWeather, setLiveWeather] = useState('Loading weather...');
  
  const [visitedActivities, setVisitedActivities] = useState({});
  const [activeTarget, setActiveTarget] = useState(null);
  const [userCoords, setUserCoords] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [audioPlayer, setAudioPlayer] = useState(null);
  
  // Modals & Drawers State
  const [showSideDrawer, setShowSideDrawer] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState('expenses'); // 'expenses' | 'vault' | 'roster' | 'offline'
  const [showSosModal, setShowSosModal] = useState(false);
  const [activeTicketModal, setActiveTicketModal] = useState(null);

  // Expense Splitter State
  const [expenses, setExpenses] = useState([]);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState('INR');
  const [forexRates, setForexRates] = useState({ INR: 1, USD: 0.012, EUR: 0.011, THB: 0.42, AED: 0.044, JPY: 1.85, SGD: 0.016 });
  const [cacheStatus, setCacheStatus] = useState({ isCaching: false, progress: 0, completed: false });

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarkerRef = useRef(null);
  const activeRouteLayerRef = useRef(null);
  const targetMarkerRef = useRef(null);

  const localFallbackImage = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80";

  // Monitor Network Status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 1. Fetch Trip Data with LocalStorage Backup & Real-Time Sync
  useEffect(() => {
    async function fetchTrip() {
      const localCachedTrip = localStorage.getItem(`routeflow_trip_${tripId}`);
      if (localCachedTrip) {
        try {
          const parsed = JSON.parse(localCachedTrip);
          setItinerary(parsed);
          if (parsed.visited_stops) setVisitedActivities(parsed.visited_stops);
          if (parsed.expenses) setExpenses(parsed.expenses);
        } catch (e) { console.error(e); }
      }

      if (navigator.onLine) {
        const { data, error } = await supabase.from('itineraries').select('*').eq('id', tripId).single();
        if (!error && data) {
          setItinerary(data);
          localStorage.setItem(`routeflow_trip_${tripId}`, JSON.stringify(data));
          if (data.visited_stops) setVisitedActivities(data.visited_stops);
          if (data.expenses) setExpenses(data.expenses);
          fetchLiveWeather(data.destination);
        }
      }
      setLoading(false);
    }
    fetchTrip();

    fetch('https://open.er-api.com/v6/latest/INR')
      .then(res => res.json())
      .then(data => {
        if (data && data.rates) setForexRates(data.rates);
      })
      .catch(() => console.log('Using default forex rates'));

    const channel = supabase
      .channel(`realtime:itinerary:${tripId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'itineraries', filter: `id=eq.${tripId}` },
        (payload) => {
          if (payload.new) {
            if (payload.new.visited_stops) setVisitedActivities(payload.new.visited_stops);
            if (payload.new.expenses) setExpenses(payload.new.expenses);
            localStorage.setItem(`routeflow_trip_${tripId}`, JSON.stringify(payload.new));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  // 2. Initialize Map Container with automatic resize calculation
  useEffect(() => {
    if (loading || !itinerary || !mapRef.current) return;

    const initMap = async () => {
      let startLat = 9.9252, startLng = 78.1198, zoomLevel = 13;

      if (activeTarget && activeTarget.lat && activeTarget.lng) {
        startLat = activeTarget.lat;
        startLng = activeTarget.lng;
      } else if (itinerary.trip_data?.[0]?.activities?.[0]?.lat) {
        startLat = itinerary.trip_data[0].activities[0].lat;
        startLng = itinerary.trip_data[0].activities[0].lng;
      } else if (navigator.onLine) {
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(itinerary.destination)}&count=1&format=json`);
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            startLat = data.results[0].latitude;
            startLng = data.results[0].longitude;
          }
        } catch (e) {
          console.error("Geocoding fallback applied", e);
        }
      }

      if (!mapInstance.current && mapRef.current) {
        const map = L.map(mapRef.current, { 
          zoomControl: false,
          attributionControl: false 
        }).setView([startLat, startLng], zoomLevel);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          subdomains: ['a', 'b', 'c']
        }).addTo(map);

        mapInstance.current = map;

        setTimeout(() => {
          if (mapInstance.current) mapInstance.current.invalidateSize();
        }, 300);
        setTimeout(() => {
          if (mapInstance.current) mapInstance.current.invalidateSize();
        }, 800);
      }
    };

    initMap();
  }, [loading, itinerary]);

  // 3. Scan for Next Target
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

  // 4. Live GPS Position
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

  // 5. Draw High-Speed Route
  useEffect(() => {
    if (!mapInstance.current || !activeTarget) return;

    const targetCoords = [activeTarget.lat, activeTarget.lng];

    if (targetMarkerRef.current) {
      targetMarkerRef.current
        .setLatLng(targetCoords)
        .setPopupContent(`<b>Target:</b> ${activeTarget.title}`)
        .openPopup();
    } else {
      const flagIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="
            width: 30px; 
            height: 30px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            filter: drop-shadow(0px 3px 5px rgba(0, 0, 0, 0.3));
          ">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#ef4444" stroke="#ffffff" stroke-width="1.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5" fill="#ffffff"/>
            </svg>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 30]
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
      const isDriving = activeTarget.is_driving_route ?? true;

      if (!isDriving) {
        activeRouteLayerRef.current = L.polyline([userCoords, targetCoords], {
          color: '#2563eb',
          weight: 4,
          dashArray: '8, 12',
          opacity: 0.8
        }).addTo(mapInstance.current);

        mapInstance.current.fitBounds([userCoords, targetCoords], { padding: [30, 30] });
      } else {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${userCoords[1]},${userCoords[0]};${targetCoords[1]},${targetCoords[0]}?overview=full&geometries=geojson&alternatives=true&steps=true`;

        fetch(osrmUrl)
          .then((res) => res.json())
          .then((data) => {
            if (data.routes && data.routes.length > 0) {
              const designatedHighwayRoute = data.routes.reduce((prev, curr) => 
                (curr.duration < prev.duration ? curr : prev), data.routes[0]
              );

              const coordinates = designatedHighwayRoute.geometry.coordinates.map((coord) => [coord[1], coord[0]]);
              
              if (activeRouteLayerRef.current) {
                mapInstance.current.removeLayer(activeRouteLayerRef.current);
              }

              activeRouteLayerRef.current = L.polyline(coordinates, {
                color: '#1d4ed8',
                weight: 5,
                opacity: 0.95,
                lineJoin: 'round',
                lineCap: 'round'
              }).addTo(mapInstance.current);

              mapInstance.current.fitBounds(activeRouteLayerRef.current.getBounds(), { padding: [35, 35] });
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

  // 6. Voice Assistant Handler
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

    const cacheKey = `routeflow_voice_${btoa(unescape(encodeURIComponent(text.slice(0, 32))))}`;
    const localAudioData = localStorage.getItem(cacheKey);

    if (localAudioData) {
      const audio = new Audio(localAudioData);
      setAudioPlayer(audio);
      audio.play();
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      return;
    }

    if (navigator.onLine) {
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
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        });

        if (response.ok) {
          const audioBlob = await response.blob();
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            try {
              localStorage.setItem(cacheKey, reader.result);
            } catch (e) {
              console.log('LocalStorage audio quota reached');
            }
          };

          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          setAudioPlayer(audio);
          audio.play();
          audio.onended = () => setSpeaking(false);
          audio.onerror = () => setSpeaking(false);
          return;
        }
      } catch (err) {
        console.warn("Falling back to native browser speech synthesis...", err);
      }
    }

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
  };

  // 7. Offline Pre-Cache
  const preloadTripOffline = async () => {
    if (!itinerary) return;
    setCacheStatus({ isCaching: true, progress: 10, completed: false });

    try {
      localStorage.setItem(`routeflow_trip_${tripId}`, JSON.stringify(itinerary));
      setCacheStatus({ isCaching: true, progress: 50, completed: false });

      if (mapInstance.current && itinerary.trip_data) {
        const coords = [];
        itinerary.trip_data.forEach(d => {
          d.activities?.forEach(a => {
            if (a.lat && a.lng) coords.push([a.lat, a.lng]);
          });
        });
        if (coords.length > 0) {
          const bounds = L.latLngBounds(coords);
          mapInstance.current.fitBounds(bounds.pad(0.2));
        }
      }

      setCacheStatus({ isCaching: true, progress: 90, completed: false });

      setTimeout(() => {
        setCacheStatus({ isCaching: false, progress: 100, completed: true });
      }, 800);

    } catch (e) {
      setCacheStatus({ isCaching: false, progress: 0, completed: false });
      alert("Error caching trip.");
    }
  };

  // 8. Lead Marks Visit Over
  const handleVisitOver = async (key) => {
    if (!isTripLead) return;

    if (audioPlayer) audioPlayer.pause();
    window.speechSynthesis.cancel();
    setSpeaking(false);

    const updatedVisited = { ...visitedActivities, [key]: new Date().toISOString() };
    setVisitedActivities(updatedVisited);

    if (navigator.onLine) {
      await supabase.from('itineraries').update({ visited_stops: updatedVisited }).eq('id', tripId);
    } else {
      const cached = JSON.parse(localStorage.getItem(`routeflow_trip_${tripId}`) || '{}');
      cached.visited_stops = updatedVisited;
      localStorage.setItem(`routeflow_trip_${tripId}`, JSON.stringify(cached));
    }
  };

  // 9. Expenses Handling
  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!isTripLead || !expenseTitle || !expenseAmount) return;

    const rateToInr = forexRates[expenseCurrency] ? (1 / forexRates[expenseCurrency]) : 1;
    const amountInInr = parseFloat(expenseAmount) * rateToInr;

    const newExpenseItem = {
      id: Date.now().toString(),
      title: expenseTitle,
      amount: parseFloat(expenseAmount),
      currency: expenseCurrency,
      amountInInr: Math.round(amountInInr),
      loggedBy: itinerary.client_name,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedExpenses = [newExpenseItem, ...expenses];
    setExpenses(updatedExpenses);
    setExpenseTitle('');
    setExpenseAmount('');

    if (navigator.onLine) {
      await supabase.from('itineraries').update({ expenses: updatedExpenses }).eq('id', tripId);
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    if (!isTripLead) return;
    const updatedExpenses = expenses.filter(item => item.id !== expenseId);
    setExpenses(updatedExpenses);
    if (navigator.onLine) {
      await supabase.from('itineraries').update({ expenses: updatedExpenses }).eq('id', tripId);
    }
  };

  const totalMembersCount = 1 + (itinerary?.group_members?.length || 0);
  const totalInrSpent = expenses.reduce((acc, curr) => acc + (curr.amountInInr || curr.amount || 0), 0);
  const perPersonInrShare = Math.round(totalInrSpent / totalMembersCount);

  const allVaultTickets = [];
  itinerary?.trip_data?.forEach((day) => {
    day.activities?.forEach((act) => {
      if (act.ticketName || act.ticketUrl) {
        allVaultTickets.push({ ...act, dayTitle: day.dayTitle });
      }
    });
  });

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

  const handleSosTrigger = () => {
    const coordsText = userCoords ? `${userCoords[0].toFixed(5)}, ${userCoords[1].toFixed(5)}` : "Acquiring GPS...";
    const mapsLink = userCoords ? `https://maps.google.com/?q=${userCoords[0]},${userCoords[1]}` : "Location pending";
    const emergencyMessage = encodeURIComponent(
      `🚨 EMERGENCY SOS ALERT!\n\nTraveler: ${itinerary.client_name} (${isTripLead ? 'Trip Lead' : 'Companion'})\nDestination: ${itinerary.destination}\nTrip ID: ${itinerary.id}\nLive GPS: ${coordsText}\nGoogle Maps: ${mapsLink}\n\nImmediate assistance requested!`
    );
    window.open(`https://wa.me/918008625370?text=${emergencyMessage}`, '_blank');
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#FAFAFA] text-slate-800">Loading Portal...</div>;
  if (!itinerary) return <div className="h-screen flex items-center justify-center bg-[#FAFAFA]">Itinerary Offline.</div>;

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-[#FAFAFA] flex flex-col relative shadow-2xl overflow-x-hidden text-slate-900 font-sans antialiased">
      
      {/* 1. Header Banner */}
      <div className="h-[28vh] sm:h-[30vh] w-full relative overflow-hidden bg-slate-900 shrink-0 z-10">
        <img src={itinerary.cover_image || localFallbackImage} alt={itinerary.destination} className="w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
        
        {/* Top Controls Bar */}
        <div className="absolute top-3 sm:top-4 inset-x-3 sm:inset-x-4 flex justify-between items-center z-20">
          <button 
            onClick={() => setShowSideDrawer(true)}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white flex flex-col items-center justify-center gap-1 backdrop-blur-md border border-white/20 shadow-lg active:scale-95 transition-all"
            title="Open Trip Menu"
          >
            <span className="w-4 h-0.5 bg-white rounded-full"></span>
            <span className="w-4 h-0.5 bg-white rounded-full"></span>
            <span className="w-4 h-0.5 bg-white rounded-full"></span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full font-mono backdrop-blur-md border ${isOnline ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' : 'bg-rose-500/30 text-rose-200 border-rose-400/40 animate-pulse'}`}>
              {isOnline ? '🟢 Live' : '📡 Offline'}
            </span>

            <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full font-mono backdrop-blur-md border ${isTripLead ? 'bg-amber-500/20 text-amber-300 border-amber-400/30' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'}`}>
              {isTripLead ? '👑 Lead' : '👥 Member'}
            </span>
            
            <button 
              onClick={() => setShowSosModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-[11px] sm:text-xs font-bold font-mono shadow-lg backdrop-blur-md border border-rose-400/40 active:scale-95 transition-transform animate-pulse"
            >
              <span>🚨</span>
              <span>SOS</span>
            </button>
          </div>
        </div>

        {/* Countdown Pill Card */}
        <div className="absolute bottom-3 sm:bottom-4 left-4 right-4 sm:left-6 sm:right-6 bg-white/10 backdrop-blur-xl border border-white/20 px-3 py-2.5 sm:px-5 sm:py-3.5 rounded-2xl text-center shadow-xl">
          <p className="text-[8px] sm:text-[9px] font-bold text-amber-300 tracking-widest font-mono uppercase mb-0.5">Adventure Commences In</p>
          {countdown.isExpired ? (
            <p className="text-base sm:text-lg font-bold text-white tracking-wide font-mono">TRIP ACTIVE 🚀</p>
          ) : (
            <div className="flex justify-center items-center gap-2 sm:gap-3 font-mono text-white text-lg sm:text-xl font-bold">
              <div><span>{countdown.days}</span><span className="text-[7px] sm:text-[8px] text-slate-300 block font-sans uppercase font-normal">Days</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span>{countdown.hours}</span><span className="text-[7px] sm:text-[8px] text-slate-300 block font-sans uppercase font-normal">Hrs</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span>{countdown.mins}</span><span className="text-[7px] sm:text-[8px] text-slate-300 block font-sans uppercase font-normal">Mins</span></div>
              <span className="text-amber-300/60 font-light">:</span>
              <div><span className="text-amber-300">{countdown.secs}</span><span className="text-[7px] sm:text-[8px] text-amber-300/80 block font-sans uppercase font-normal">Secs</span></div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Main Scrollable View */}
      <div className="flex-1 overflow-y-auto scroll-smooth px-4 sm:px-5 pt-4 sm:pt-5 pb-24 space-y-4 sm:space-y-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        
        {/* Title Block with Integrated Logo */}
        <div className="flex items-center gap-3">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="w-9 h-9 object-contain rounded-xl shadow-xs shrink-0"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <div>
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-amber-700 font-mono">Bespoke Portal</span>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 leading-tight">{itinerary.destination.toUpperCase()}</h1>
            <p className="text-[11px] sm:text-xs text-slate-500">Curated for <span className="font-semibold text-slate-800">{itinerary.client_name}</span></p>
          </div>
        </div>

        {/* Map Card */}
        <div className="p-2.5 sm:p-3 bg-white rounded-2xl shadow-sm border border-slate-200/70 space-y-2">
          <div className="flex justify-between items-center px-1">
            <div className="flex flex-col truncate pr-2">
              <span className="text-[8px] sm:text-[9px] font-bold tracking-wider text-slate-400 uppercase font-mono">
                {activeTarget?.is_driving_route ?? true ? '🚗 Highway Navigation Route' : '✈️ Flight Navigation Path'}
              </span>
              {activeTarget ? (
                <span className="text-[10px] sm:text-[11px] text-blue-600 font-semibold font-mono truncate">📍 {activeTarget.title}</span>
              ) : (
                <span className="text-[10px] sm:text-[11px] text-emerald-600 font-semibold font-mono">🎉 All Visits Completed!</span>
              )}
            </div>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-slate-100 rounded-full text-slate-700 font-medium font-mono shrink-0">🌤️ {liveWeather}</span>
          </div>
          
          <div className="w-full h-48 sm:h-52 rounded-xl overflow-hidden relative z-0 border border-slate-100 bg-slate-100">
            <div ref={mapRef} style={{ height: '100%', width: '100%', minHeight: '192px' }} />
          </div>
        </div>

        {/* Multi-Day Timeline & Stop Cards */}
        {itinerary.trip_data?.map((day, dayIndex) => (
          <div key={dayIndex} className="pt-1">
            <h2 className="text-xs sm:text-sm font-bold text-slate-800 uppercase tracking-wider sticky top-0 bg-[#FAFAFA]/95 backdrop-blur-md py-2 z-10 font-mono border-b border-slate-200/60 mb-3">
              {day.dayTitle}
            </h2>

            <div className="space-y-3">
              {day.activities?.map((act, actIndex) => {
                const key = `${dayIndex}-${actIndex}`;
                const isCurrentActiveTarget = activeTarget?.key === key;
                const isVisited = !!visitedActivities[key];

                return (
                  <div key={actIndex} className={`transition-all duration-300 ${isVisited ? 'opacity-40' : 'opacity-100'}`}>
                    
                    <div className={`bg-white rounded-2xl p-3.5 sm:p-4 border transition-all ${isCurrentActiveTarget ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-md' : 'border-slate-200/60 shadow-sm'}`}>
                      
                      {act.placeImage && (
                        <img src={act.placeImage} alt={act.title} className="w-full h-24 sm:h-28 object-cover rounded-xl mb-2.5" />
                      )}

                      <div className="flex justify-between items-center mb-1 gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-amber-700 font-mono">{act.time}</span>
                          <span className="text-[9px] sm:text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                            {act.is_driving_route ?? true ? '🚗 Road' : '✈️ Flight'}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          {(act.ticketUrl || act.ticketName) && (
                            <button
                              onClick={() => setActiveTicketModal(act)}
                              className="text-[10px] sm:text-[11px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-lg font-mono font-semibold transition-colors"
                            >
                              🎟️ Pass
                            </button>
                          )}

                          <button 
                            onClick={() => triggerVoiceGuide(act.description)}
                            className="text-[11px] sm:text-xs px-2 sm:px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-mono transition-colors"
                          >
                            {speaking && isCurrentActiveTarget ? "⏸️ Pause" : "🔊 Voice"}
                          </button>
                        </div>
                      </div>

                      <h3 className="font-semibold text-slate-900 text-xs sm:text-sm mb-1">{act.title}</h3>
                      <p className="text-[11px] sm:text-xs text-slate-500 leading-relaxed mb-3">{act.description}</p>

                      {/* Lead Control Action */}
                      {isCurrentActiveTarget && !isVisited && isTripLead && (
                        <button
                          onClick={() => handleVisitOver(key)}
                          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase rounded-xl font-mono transition-all active:scale-95 shadow-sm"
                        >
                          ✓ Visit Over (Advance Group Route)
                        </button>
                      )}

                      {/* Companion Sync Indicator */}
                      {isCurrentActiveTarget && !isVisited && !isTripLead && (
                        <div className="w-full py-2 bg-blue-50 text-blue-700 text-[10px] sm:text-[11px] font-mono rounded-xl text-center border border-blue-100">
                          📍 Active Stop • Awaiting Trip Lead Check-out
                        </div>
                      )}
                      
                      {isVisited && (
                        <span className="text-[10px] text-emerald-600 font-bold font-mono block">✓ Visited / Completed</span>
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
      <div className="absolute bottom-0 inset-x-0 p-3 sm:p-4 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/95 to-transparent z-20">
        <a href="https://wa.me/918008625370" target="_blank" rel="noreferrer" className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-center shadow-lg text-xs tracking-wider uppercase font-mono block transition-colors">
          💬 Connect With Travel Planner
        </a>
      </div>

      {/* 4. Slide-Out Utility Drawer (3-Dashes Menu) */}
      {showSideDrawer && (
        <div className="fixed inset-0 z-50 flex">
          <div 
            onClick={() => setShowSideDrawer(false)}
            className="flex-1 bg-black/60 backdrop-blur-sm transition-opacity"
          />

          <div className="w-[85vw] max-w-sm bg-white h-full shadow-2xl flex flex-col z-10 animate-slideLeft">
            
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm">Trip Tools & Utilities</h3>
                <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">{itinerary.destination} • {itinerary.client_name}</p>
              </div>
              <button 
                onClick={() => setShowSideDrawer(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex border-b border-slate-200 bg-slate-50 text-[10px] sm:text-[11px] font-mono">
              <button 
                onClick={() => setActiveDrawerTab('expenses')}
                className={`flex-1 py-3 text-center font-bold border-b-2 transition-colors ${activeDrawerTab === 'expenses' ? 'border-amber-600 text-amber-700 bg-white' : 'border-transparent text-slate-500'}`}
              >
                💰 Split
              </button>
              <button 
                onClick={() => setActiveDrawerTab('vault')}
                className={`flex-1 py-3 text-center font-bold border-b-2 transition-colors ${activeDrawerTab === 'vault' ? 'border-amber-600 text-amber-700 bg-white' : 'border-transparent text-slate-500'}`}
              >
                🎟️ Passes
              </button>
              <button 
                onClick={() => setActiveDrawerTab('roster')}
                className={`flex-1 py-3 text-center font-bold border-b-2 transition-colors ${activeDrawerTab === 'roster' ? 'border-amber-600 text-amber-700 bg-white' : 'border-transparent text-slate-500'}`}
              >
                👥 Group
              </button>
              <button 
                onClick={() => setActiveDrawerTab('offline')}
                className={`flex-1 py-3 text-center font-bold border-b-2 transition-colors ${activeDrawerTab === 'offline' ? 'border-amber-600 text-amber-700 bg-white' : 'border-transparent text-slate-500'}`}
              >
                ⚡ Offline
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* TAB 1: EXPENSES */}
              {activeDrawerTab === 'expenses' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-4 rounded-2xl text-white space-y-2 shadow-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-amber-300">Total Group Spending</span>
                      <span className="text-[9px] sm:text-[10px] font-mono text-slate-400">{totalMembersCount} Travelers</span>
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono">₹{totalInrSpent.toLocaleString('en-IN')}</div>
                    <div className="pt-2 border-t border-white/10 flex justify-between text-xs font-mono text-slate-300">
                      <span>Each Person Share:</span>
                      <span className="font-bold text-emerald-400">₹{perPersonInrShare.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  {isTripLead ? (
                    <form onSubmit={handleAddExpense} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                      <span className="text-[11px] font-bold text-slate-700 font-mono block">➕ Log New Shared Expense</span>
                      <input 
                        type="text" 
                        placeholder="Expense Title (e.g. Dinner)" 
                        value={expenseTitle} 
                        onChange={(e) => setExpenseTitle(e.target.value)}
                        className="w-full p-2 border rounded-xl text-xs bg-white focus:outline-slate-900"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input 
                          type="number" 
                          placeholder="Amount" 
                          value={expenseAmount} 
                          onChange={(e) => setExpenseAmount(e.target.value)}
                          className="p-2 border rounded-xl text-xs bg-white focus:outline-slate-900 font-mono"
                          required
                        />
                        <select 
                          value={expenseCurrency} 
                          onChange={(e) => setExpenseCurrency(e.target.value)}
                          className="p-2 border rounded-xl text-xs bg-white font-mono cursor-pointer"
                        >
                          <option value="INR">INR (₹)</option>
                          <option value="USD">USD ($)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="THB">THB (฿)</option>
                          <option value="AED">AED (د.إ)</option>
                          <option value="JPY">JPY (¥)</option>
                          <option value="SGD">SGD (S$)</option>
                        </select>
                      </div>
                      <button 
                        type="submit"
                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs font-mono uppercase tracking-wider transition-colors shadow-sm"
                      >
                        + Add To Group Ledger
                      </button>
                    </form>
                  ) : (
                    <div className="p-3 bg-blue-50 text-blue-700 text-[11px] font-mono rounded-xl text-center border border-blue-100">
                      👥 Live Companion Ledger View (Managed by Trip Lead)
                    </div>
                  )}

                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Shared Ledger ({expenses.length})</span>
                    {expenses.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-4 text-center">No expenses logged yet.</p>
                    ) : (
                      expenses.map((item) => (
                        <div key={item.id} className="p-3 bg-white border border-slate-200/80 rounded-xl flex justify-between items-center shadow-xs">
                          <div>
                            <h4 className="text-xs font-semibold text-slate-800">{item.title}</h4>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {item.currency} {item.amount} • {item.timestamp}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold font-mono text-slate-900">₹{item.amountInInr?.toLocaleString('en-IN')}</span>
                            {isTripLead && (
                              <button 
                                onClick={() => handleDeleteExpense(item.id)}
                                className="text-slate-300 hover:text-rose-600 text-xs pl-1"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: PASSES */}
              {activeDrawerTab === 'vault' && (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Attached Passes ({allVaultTickets.length})</span>
                  {allVaultTickets.length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-6 text-center">No entry tickets uploaded for this trip.</p>
                  ) : (
                    allVaultTickets.map((t, idx) => (
                      <div key={idx} className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-2xl space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <span className="text-[9px] font-mono uppercase tracking-wider text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-full">
                              {t.dayTitle.split(':')[0]}
                            </span>
                            <h4 className="text-xs font-bold text-slate-900 mt-1">{t.title}</h4>
                            <p className="text-[11px] font-mono text-slate-600 truncate max-w-[150px]">{t.ticketName || "General Pass"}</p>
                          </div>
                          <button 
                            onClick={() => {
                              setShowSideDrawer(false);
                              setActiveTicketModal(t);
                            }}
                            className="text-xs bg-slate-900 hover:bg-slate-800 text-white font-mono px-3 py-1.5 rounded-lg shadow-sm shrink-0"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: ROSTER */}
              {activeDrawerTab === 'roster' && (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Travel Group ({totalMembersCount})</span>
                  
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex justify-between items-center">
                    <div>
                      <span className="text-[9px] font-mono font-bold text-amber-800 uppercase bg-amber-200/60 px-2 py-0.5 rounded-md">👑 Trip Leader</span>
                      <h4 className="text-xs font-bold text-slate-900 mt-1">{itinerary.client_name}</h4>
                      <p className="text-[10px] font-mono text-slate-500">{itinerary.whatsapp_number || "Primary Contact"}</p>
                    </div>
                  </div>

                  {itinerary.group_members?.map((m, idx) => (
                    <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl flex justify-between items-center">
                      <div>
                        <span className="text-[9px] font-mono font-bold text-blue-700 uppercase bg-blue-50 px-2 py-0.5 rounded-md">👥 Companion</span>
                        <h4 className="text-xs font-bold text-slate-900 mt-1">{m.name}</h4>
                        <p className="text-[10px] font-mono text-slate-500">{m.phone || "No phone listed"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 4: OFFLINE */}
              {activeDrawerTab === 'offline' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <span className="text-xs font-bold text-slate-800 font-mono block">⚡ Offline Pre-Cache Engine</span>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Download map bounds, voice guide assets, and passes to your device while connected to Wi-Fi.
                    </p>

                    <button
                      onClick={preloadTripOffline}
                      disabled={cacheStatus.isCaching}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs font-mono uppercase tracking-wider transition-colors shadow-sm mt-2"
                    >
                      {cacheStatus.isCaching ? `Caching Assets (${cacheStatus.progress}%)...` : cacheStatus.completed ? '✅ Trip Successfully Cached' : '⚡ Cache Trip For Offline Use'}
                    </button>
                  </div>

                  <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-[10px] sm:text-[11px] font-mono border border-emerald-200 leading-relaxed">
                    💡 When cellular network drops, RouteFlow automatically switches to local device cache.
                  </div>
                </div>
              )}

            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2">
              <button 
                onClick={() => {
                  setShowSideDrawer(false);
                  setShowSosModal(true);
                }}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs uppercase font-mono tracking-wider flex items-center justify-center gap-1.5 shadow-sm"
              >
                <span>🚨</span> Trigger Emergency SOS
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 5. Ticket Pass Modal */}
      {activeTicketModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-xs bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-amber-100 space-y-4 text-center relative">
            <button 
              onClick={() => setActiveTicketModal(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-sm font-bold"
            >
              ✕
            </button>

            <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto text-xl">
              🎟️
            </div>

            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Verified Entry Pass
              </span>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-2">{activeTicketModal.title}</h3>
              <p className="text-xs font-mono text-slate-500 mt-0.5 truncate">{activeTicketModal.ticketName || "General Admission Pass"}</p>
            </div>

            {activeTicketModal.ticketUrl ? (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center">
                <img 
                  src={activeTicketModal.ticketUrl} 
                  alt="Pass Document" 
                  className="w-40 h-40 object-contain rounded-xl shadow-inner bg-white p-2"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <a 
                  href={activeTicketModal.ticketUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[11px] font-mono text-blue-600 hover:underline mt-2 font-bold block"
                >
                  🔗 Open High-Res Pass
                </a>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 rounded-2xl text-xs font-mono text-slate-600 border border-slate-100">
                Present this reference to venue staff at entry.
              </div>
            )}

            <button
              onClick={() => setActiveTicketModal(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider font-mono shadow-md"
            >
              Close Pass
            </button>
          </div>
        </div>
      )}

      {/* 6. SOS Emergency Modal */}
      {showSosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-xs sm:max-w-sm bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-rose-100 space-y-3.5 text-center">
            
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-xl animate-bounce">
              🚨
            </div>

            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Emergency SOS Assist</h3>
              <p className="text-xs text-slate-500 mt-1">
                Dispatch your exact coordinates to your concierge or emergency dispatch.
              </p>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-[10px] sm:text-[11px] font-mono text-slate-600">
              <span className="font-bold text-slate-700 block mb-0.5">Live GPS Coordinates:</span>
              {userCoords ? `${userCoords[0].toFixed(5)}, ${userCoords[1].toFixed(5)}` : "Acquiring live GPS..."}
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={handleSosTrigger}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider font-mono shadow-lg shadow-rose-600/30 active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <span>💬</span> Dispatch WhatsApp Alert
              </button>

              <a
                href="tel:112"
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider font-mono shadow-md block active:scale-95 transition-transform"
              >
                📞 Call Local Emergency (112)
              </a>

              <button
                onClick={() => setShowSosModal(false)}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 font-medium font-mono"
              >
                Dismiss
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}