import React, { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import L from 'leaflet';

export default function ClientPortal({ tripId }) {
  const [itinerary, setItinerary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ days: '00', hours: '00', mins: '00', secs: '00' });
  const [liveWeather, setLiveWeather] = useState('Loading weather...');
  
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarkerRef = useRef(null);
  const markersGroupRef = useRef(null);

  const localFallbackImage = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80";

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

    const realtimeChannel = supabase
      .channel(`live-trip-${tripId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'itineraries', filter: `id=eq.${tripId}` }, 
        (payload) => {
          setItinerary(payload.new);
          fetchLiveWeather(payload.new.destination);
        }
      ).subscribe();

    return () => { supabase.removeChannel(realtimeChannel); };
  }, [tripId]);

  // Street-Level Map Centering & Tracking Controller
  useEffect(() => {
    if (!itinerary || !mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([20.5937, 78.9629], 5);
    markersGroupRef.current = L.featureGroup().addTo(mapInstance.current);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance.current);

    const latLngs = [];

    itinerary.trip_data?.forEach(day => {
      day.activities?.forEach(act => {
        if (act.lat && act.lng) {
          latLngs.push([act.lat, act.lng]);
          L.marker([act.lat, act.lng])
            .addTo(markersGroupRef.current)
            .bindPopup(`<b>${act.time}</b><br/>${act.title}`);
        }
      });
    });

    if (latLngs.length > 0) {
      L.polyline(latLngs, {
        color: '#b45309',
        weight: 4,
        dashArray: '5, 10',
        opacity: 0.8
      }).addTo(mapInstance.current);

      mapInstance.current.fitBounds(markersGroupRef.current.getBounds(), { padding: [40, 40] });
    }

    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          } else {
            const userIcon = L.divIcon({
              className: 'bg-blue-600 w-4 h-4 rounded-full ring-4 ring-white shadow-lg animate-pulse',
              iconSize: [16, 16]
            });
            userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon })
              .addTo(mapInstance.current)
              .bindPopup("Your Location");
          }
        },
        () => console.log("Awaiting device tracking signal..."),
        { enableHighAccuracy: true }
      );
    }
  }, [itinerary]);

  async function fetchLiveWeather(locationName) {
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&format=json`);
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) return setLiveWeather("Weather unavailable");
      const { latitude, longitude } = geoData.results[0];
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
      const weatherData = await weatherRes.json();
      if (weatherData.current_weather) {
        const temp = Math.round(weatherData.current_weather.temperature);
        const code = weatherData.current_weather.weathercode;
        let condition = "Clear";
        if (code >= 1 && code <= 3) condition = "Partly Cloudy";
        if (code >= 51 && code <= 67) condition = "Raining";
        setLiveWeather(`${condition}, ${temp}°C`);
      }
    } catch (err) { setLiveWeather("Live sync paused"); }
  }

  // Running Ticker: High-accuracy real-time countdown calculating days, hours, mins, and seconds
  useEffect(() => {
    if (!itinerary || !itinerary.departure_date) return;
    const interval = setInterval(() => {
      const targetTime = new Date(`${itinerary.departure_date}T00:00:00`).getTime();
      const now = new Date().getTime();
      const distance = targetTime - now;

      if (distance < 0) {
        setCountdown({ days: '00', hours: '00', mins: '00', secs: '00', isExpired: true });
        clearInterval(interval);
      } else {
        const d = Math.floor(distance / (1000 * 60 * 60 * 24));
        const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);

        setCountdown({
          days: d < 10 ? `0${d}` : `${d}`,
          hours: h < 10 ? `0${h}` : `${h}`,
          mins: m < 10 ? `0${m}` : `${m}`,
          secs: s < 10 ? `0${s}` : `${s}`,
          isExpired: false
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [itinerary]);

  const formatTimeToAMPM = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    let h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${minutes} ${ampm}`;
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-medium bg-[#F9F8F6] text-[#1C2C24]">Loading Portal...</div>;
  if (!itinerary) return <div className="h-screen flex items-center justify-center font-medium bg-[#F9F8F6] text-[#1C2C24]">Itinerary not found.</div>;

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-[#F9F8F6] flex flex-col relative shadow-2xl overflow-hidden text-[#1C2C24]">
      
      {/* 1. Viewport Hero Image Container */}
      <div className="h-[35vh] w-full relative overflow-hidden bg-slate-900 flex items-center justify-center">
        <img 
          src={itinerary.cover_image || localFallbackImage} 
          alt={itinerary.destination} 
          className="w-full h-full absolute inset-0 object-cover opacity-85" 
          onError={(e) => { e.target.src = localFallbackImage; }} 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10" />
        
        {/* ENHANCED LIVE COUNTDOWN MATRIX DISPLAY - MUCH LARGER & TICKING OVER IMAGE CENTER */}
        <div className="relative z-10 bg-[#1C2C24]/90 backdrop-blur-md px-6 py-4 rounded-3xl border border-amber-500/30 text-center shadow-xl min-w-[80%]">
          <p className="text-[10px] font-bold text-amber-400 tracking-widest font-mono uppercase mb-2">Adventure Commences In</p>
          
          {countdown.isExpired ? (
            <p className="text-xl font-bold text-white tracking-wide font-mono leading-none">TRIP ACTIVE 🚀</p>
          ) : (
            <div className="flex justify-center items-center gap-3 font-mono text-white">
              <div>
                <span className="text-3xl font-bold tracking-tight block leading-none">{countdown.days}</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mt-1 block">Days</span>
              </div>
              <span className="text-2xl font-bold text-amber-500/80 mb-4">:</span>
              <div>
                <span className="text-3xl font-bold tracking-tight block leading-none">{countdown.hours}</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mt-1 block">Hrs</span>
              </div>
              <span className="text-2xl font-bold text-amber-500/80 mb-4">:</span>
              <div>
                <span className="text-3xl font-bold tracking-tight block leading-none">{countdown.mins}</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mt-1 block">Mins</span>
              </div>
              <span className="text-2xl font-bold text-amber-500/80 mb-4">:</span>
              <div>
                <span className="text-3xl font-bold tracking-tight text-amber-400 block leading-none">{countdown.secs}</span>
                <span className="text-[9px] text-amber-400/80 uppercase font-bold tracking-wider mt-1 block">Secs</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Scroll Area Container */}
      <div className="flex-1 overflow-y-auto px-6 pb-26 pt-6 space-y-6">
        
        {/* Dynamic Headers Layer */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-amber-700 font-bold mb-0.5 font-mono">Bespoke Portal</p>
          <h1 className="font-editorial text-3xl text-[#1C2C24] font-bold tracking-tight leading-none mb-1">
            {itinerary.destination.toUpperCase()}
          </h1>
          <p className="text-xs text-slate-500">
            Curated for <span className="font-bold text-[#1C2C24]">{itinerary.client_name}</span>
          </p>
        </div>

        {/* Boxed Map Canvas Component */}
        <div className="w-full p-3 bg-white rounded-2xl shadow-md border border-slate-200/40 space-y-2.5">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-bold tracking-wider text-[#655E4E] uppercase font-mono">Live Route Grid</span>
            <span className="text-[10px] px-2.5 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-amber-950 font-bold font-mono">
              🌤️ {liveWeather}
            </span>
          </div>
          <div className="w-full aspect-[16/10] rounded-xl overflow-hidden bg-[#FAF9F6] relative z-0 border border-slate-100">
            <div ref={mapRef} className="w-full h-full" />
          </div>
        </div>

        {/* Timeline Dynamic Day Tracks */}
        {itinerary.trip_data && itinerary.trip_data.map((day, dayIndex) => (
          <div key={dayIndex} className="pt-2">
            <h2 className="font-editorial text-lg text-[#1C2C24] font-bold sticky top-0 bg-[#F9F8F6]/95 backdrop-blur-md py-2 z-10 mb-3">
              {day.dayTitle}
            </h2>
            <div className="border-l-2 border-[#E5DFD3] pl-5 space-y-5 ml-1">
              {day.activities && day.activities.map((act, actIndex) => (
                <div key={actIndex} className="relative">
                  <div className="absolute -left-[27px] top-2 w-2 h-2 rounded-full bg-[#b45309] ring-4 ring-[#F9F8F6]" />
                  <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <span className="text-[11px] font-bold text-[#b45309] tracking-wider uppercase font-mono block mb-1">
                      {formatTimeToAMPM(act.time)}
                    </span>
                    <h3 className="font-bold text-[#1C2C24] text-sm mb-0.5">{act.title}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{act.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 3. Bottom Action Navigation Bar Anchor */}
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-[#F9F8F6] via-[#F9F8F6] to-transparent z-20">
        <a 
          href="https://wa.me/918008625370" 
          target="_blank" 
          rel="noreferrer" 
          className="w-full py-3.5 bg-[#1C2C24] text-white font-medium rounded-xl text-center shadow-lg text-xs tracking-wider uppercase font-mono block transition-transform active:scale-95 hover:bg-emerald-950"
        >
          💬 Connect With Travel Planner
        </a>
      </div>
    </div>
  );
}