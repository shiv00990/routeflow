import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function AgentDashboard() {
  const [itineraries, setItineraries] = useState([]);
  const [clientName, setClientName] = useState('');
  const [destination, setDestination] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [globalIsDriving, setGlobalIsDriving] = useState(true);

  // Dynamic Multi-Day Initial State
  const [tripDays, setTripDays] = useState([
    {
      dayTitle: "Day 1: Arrival & Exploration",
      activities: [
        { time: "12:00", title: "", address: "", lat: null, lng: null, placeImage: "", description: "", hasMap: true }
      ]
    }
  ]);

  const [destSuggestions, setDestSuggestions] = useState([]); 
  const [activitySuggestions, setActivitySuggestions] = useState({}); 

  const [isEditing, setIsEditing] = useState(false);
  const [editingTripId, setEditingTripId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchItineraries(); }, []);

  async function fetchItineraries() {
    const { data } = await supabase.from('itineraries').select('*').order('created_at', { ascending: false });
    if (data) setItineraries(data);
  }

  useEffect(() => {
    if (destination.length < 3) {
      setDestSuggestions([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=5`, {
          headers: { 'User-Agent': 'RouteFlowTravelEngine/1.0' }
        });
        const data = await res.json();
        setDestSuggestions(data || []);
      } catch (e) {
        console.error(e);
      }
    }, 400);
    return () => clearTimeout(delayDebounceFn);
  }, [destination]);

  const selectDestination = (item) => {
    setDestination(item.display_name.split(',')[0]); 
    setDestSuggestions([]); 
  };

  const handlePlaceInputChange = (dayIndex, actIndex, query) => {
    updateActivityField(dayIndex, actIndex, 'title', query);
    if (query.length < 3) {
      setActivitySuggestions(prev => ({ ...prev, [`${dayIndex}-${actIndex}`]: [] }));
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
          headers: { 'User-Agent': 'RouteFlowTravelEngine/1.0' }
        });
        const data = await res.json();
        setActivitySuggestions(prev => ({ ...prev, [`${dayIndex}-${actIndex}`]: data || [] }));
      } catch (e) {
        console.error(e);
      }
    }, 400);

    if (window.activePlaceSearch) clearTimeout(window.activePlaceSearch);
    window.activePlaceSearch = timeoutId;
  };

  const selectActivityAddress = (dayIndex, actIndex, item) => {
    const updatedDays = [...tripDays];
    updatedDays[dayIndex].activities[actIndex].title = item.display_name.split(',')[0];
    updatedDays[dayIndex].activities[actIndex].address = item.display_name;
    updatedDays[dayIndex].activities[actIndex].lat = parseFloat(item.lat);
    updatedDays[dayIndex].activities[actIndex].lng = parseFloat(item.lon);
    setTripDays(updatedDays);
    setActivitySuggestions(prev => ({ ...prev, [`${dayIndex}-${actIndex}`]: [] }));
  };

  // MULTI-DAY MANAGEMENT FUNCTIONS
  const addNewDay = () => {
    const nextDayNum = tripDays.length + 1;
    setTripDays([
      ...tripDays,
      {
        dayTitle: `Day ${nextDayNum}: Sightseeing & Highlights`,
        activities: [
          { time: "09:00", title: "", address: "", lat: null, lng: null, placeImage: "", description: "", hasMap: true }
        ]
      }
    ]);
  };

  const removeDay = (dayIndex) => {
    if (tripDays.length === 1) return alert("Trip must have at least Day 1!");
    const updated = tripDays.filter((_, idx) => idx !== dayIndex);
    setTripDays(updated);
  };

  const addActivity = (dayIndex) => {
    const updatedDays = [...tripDays];
    updatedDays[dayIndex].activities.push({ time: "14:00", title: "", address: "", lat: null, lng: null, placeImage: "", description: "", hasMap: true });
    setTripDays(updatedDays);
  };

  const removeActivity = (dayIndex, actIndex) => {
    const updatedDays = [...tripDays];
    if (updatedDays[dayIndex].activities.length === 1) return alert("Each day needs at least one stop!");
    updatedDays[dayIndex].activities = updatedDays[dayIndex].activities.filter((_, idx) => idx !== actIndex);
    setTripDays(updatedDays);
  };

  const updateActivityField = (dayIndex, actIndex, field, value) => {
    const updatedDays = [...tripDays];
    updatedDays[dayIndex].activities[actIndex][field] = value;
    setTripDays(updatedDays);
  };

  const generateCatchyDescription = (title, dIdx, aIdx) => {
    if (!title) return alert('Enter a place name first!');
    const hooks = [
      `Immerse yourself in the breathtaking views and vibrant energy of ${title}. A curated premium experience.`,
      `Indulge in an exclusive, handpicked encounter at ${title}, crafted to blend relaxation with true local character.`,
      `Discover the hidden charm of ${title} as the beautiful atmosphere sets the perfect stage for unforgettable moments.`
    ];
    const randomSnippet = hooks[Math.floor(Math.random() * hooks.length)];
    updateActivityField(dIdx, aIdx, 'description', randomSnippet);
  };

  const startEditing = (trip) => {
    setIsEditing(true);
    setEditingTripId(trip.id);
    setClientName(trip.client_name);
    setDestination(trip.destination);
    setWhatsapp(trip.whatsapp_number || '');
    setDepartureDate(trip.departure_date || '');
    setCoverImage(trip.cover_image || '');
    setGlobalIsDriving(trip.is_driving_route ?? true);
    setTripDays(trip.trip_data || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditingTripId(null);
    setClientName(''); setDestination(''); setWhatsapp(''); setDepartureDate(''); setCoverImage(''); setGlobalIsDriving(true);
    setTripDays([{ dayTitle: "Day 1: Arrival & Exploration", activities: [{ time: "12:00", title: "", address: "", lat: null, lng: null, placeImage: "", description: "", hasMap: true }] }]);
  };

  const triggerWhatsAppRedirect = (id, name, dest) => {
    const cleanNumber = whatsapp.replace(/\D/g, ''); 
    const liveUrl = `${window.location.origin}/?id=${id}`;
    const actionText = isEditing ? "updated" : "ready";
    const message = encodeURIComponent(
      `Hello ${name}! ✨ Your custom live itinerary for ${dest} has been ${actionText}. Track your routes, live weather updates, and timeline shifts instantly here: ${liveUrl}`
    );
    window.open(`https://wa.me/${cleanNumber}?text=${message}`, '_blank');
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!clientName || !destination || !departureDate) return alert('Please complete the core fields.');
    setLoading(true);

    const standardImage = coverImage.trim() || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80';
    const payload = {
      client_name: clientName,
      destination: destination,
      whatsapp_number: whatsapp,
      departure_date: departureDate,
      trip_data: tripDays,
      cover_image: standardImage,
      is_driving_route: globalIsDriving
    };

    let error = null;
    let data = null;

    if (isEditing) {
      const response = await supabase.from('itineraries').update(payload).eq('id', editingTripId).select();
      error = response.error; data = response.data;
    } else {
      const response = await supabase.from('itineraries').insert([payload]).select();
      error = response.error; data = response.data;
    }

    if (!error && data) {
      triggerWhatsAppRedirect(data[0].id, clientName, destination);
      cancelEditing();
      fetchItineraries();
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#F4F4F0] p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="font-editorial text-3xl text-slate-900 tracking-tight">📍 RouteFlow Control Panel</h1>
            <p className="text-xs text-slate-500 mt-1">Multi-Day Travel Planner Engine</p>
          </div>
          {isEditing && (
            <button type="button" onClick={cancelEditing} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-xs font-semibold text-slate-700">Cancel Edit Mode</button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60 grid grid-cols-1 md:grid-cols-2 gap-4 relative z-50">
            <input type="text" placeholder="Client Name" value={clientName} onChange={(e) => setClientName(e.target.value)} className="px-4 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-sm w-full" />
            
            <div className="relative">
              <input 
                type="text" 
                placeholder="City Destination (e.g., Madurai)" 
                value={destination} 
                onChange={(e) => setDestination(e.target.value)} 
                className="px-4 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-sm w-full focus:outline-slate-900" 
              />
              {destSuggestions && destSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-[9999] text-xs divide-y divide-slate-100 block">
                  {destSuggestions.map((item, idx) => (
                    <div key={idx} onClick={() => selectDestination(item)} className="p-3 hover:bg-slate-50 cursor-pointer text-slate-700 truncate font-medium">📍 {item.display_name}</div>
                  ))}
                </div>
              )}
            </div>

            <input type="text" placeholder="Client WhatsApp Number" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="px-4 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-sm w-full" />
            <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="px-4 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-sm text-slate-600 w-full" />
            <input type="text" placeholder="Cover Image URL" value={coverImage} onChange={(e) => setCoverImage(e.target.value)} className="px-4 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-sm md:col-span-2 w-full" />

            <div className="md:col-span-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <label className="text-sm font-bold text-slate-800 mb-1.5 block">Map Route Type</label>
              <select 
                value={globalIsDriving ? "driving" : "direct"} 
                onChange={(e) => setGlobalIsDriving(e.target.value === "driving")}
                className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm w-full focus:ring-1 focus:ring-slate-900 focus:outline-none"
              >
                <option value="driving">Road Route (Precision GPS Road Tracking)</option>
                <option value="direct">Air Route (Direct Flying Line)</option>
              </select>
            </div>
          </div>

          {/* DYNAMIC MULTI-DAY LIST */}
          {tripDays.map((day, dIdx) => (
            <div key={dIdx} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/60 space-y-4 relative">
              <div className="flex justify-between items-center border-b border-dashed border-slate-300 pb-2">
                <input 
                  type="text" 
                  value={day.dayTitle} 
                  onChange={(e) => {
                    const copy = [...tripDays]; 
                    copy[dIdx].dayTitle = e.target.value; 
                    setTripDays(copy);
                  }} 
                  className="font-editorial text-xl text-slate-800 focus:outline-none w-full bg-transparent font-bold" 
                />
                {tripDays.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => removeDay(dIdx)}
                    className="text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded bg-rose-50"
                  >
                    🗑️ Remove Day
                  </button>
                )}
              </div>
              
              <div className="space-y-4">
                {day.activities && day.activities.map((act, aIdx) => {
                  const sKey = `${dIdx}-${aIdx}`;
                  const currentSuggestions = activitySuggestions[sKey] || [];
                  
                  return (
                    <div key={aIdx} className="p-4 bg-[#FAF9F6] rounded-xl border border-slate-200 space-y-3 relative">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                        <input type="time" value={act.time} onChange={(e) => updateActivityField(dIdx, aIdx, 'time', e.target.value)} className="p-2 border rounded-lg text-xs bg-white text-slate-700" />
                        
                        <div className="relative">
                          <input 
                            type="text" 
                            placeholder="Type Place (e.g., Meenakshi Temple)" 
                            value={act.title} 
                            onChange={(e) => handlePlaceInputChange(dIdx, aIdx, e.target.value)} 
                            className="p-2 border rounded-lg text-xs bg-white w-full focus:outline-slate-900"
                          />
                          {currentSuggestions && currentSuggestions.length > 0 && (
                            <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-40 overflow-y-auto z-[9999] text-xs divide-y divide-slate-100 block">
                              {currentSuggestions.map((item, idx) => (
                                <div key={idx} onClick={() => selectActivityAddress(dIdx, aIdx, item)} className="p-3 hover:bg-slate-50 cursor-pointer text-slate-700 truncate font-medium">✨ {item.display_name}</div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pl-2">
                          <button type="button" onClick={() => generateCatchyDescription(act.title, dIdx, aIdx)} className="text-[10px] px-2.5 py-1 bg-amber-600 text-white font-medium rounded-md hover:bg-amber-700">✨ AI Catchy Text</button>
                          <button type="button" onClick={() => removeActivity(dIdx, aIdx)} className="text-[10px] text-slate-400 hover:text-rose-600">✕ Delete Stop</button>
                        </div>
                      </div>

                      <input 
                        type="text" 
                        placeholder="Paste Specific Place Image URL" 
                        value={act.placeImage || ''} 
                        onChange={(e) => updateActivityField(dIdx, aIdx, 'placeImage', e.target.value)}
                        className="w-full p-2 border rounded-lg text-xs bg-white focus:outline-slate-900"
                      />

                      {act.address && (
                        <div className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 font-mono truncate">
                          📍 Confirmed Address Locked: {act.lat?.toFixed(4)}, {act.lng?.toFixed(4)}
                        </div>
                      )}

                      <textarea placeholder="Itinerary Description details..." value={act.description} onChange={(e) => updateActivityField(dIdx, aIdx, 'description', e.target.value)} className="w-full p-2.5 border rounded-lg text-xs bg-white h-16 resize-none" />
                    </div>
                  );
                })}
              </div>

              <button type="button" onClick={() => addActivity(dIdx)} className="text-xs font-semibold text-amber-800 hover:text-amber-900 block">+ Add Stop Card to {day.dayTitle.split(':')[0]}</button>
            </div>
          ))}

          {/* ADD NEW DAY BUTTON */}
          <button 
            type="button" 
            onClick={addNewDay}
            className="w-full py-3 bg-white border-2 border-dashed border-slate-300 hover:border-slate-400 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-2xl transition-colors font-mono"
          >
            + Add New Day to Itinerary
          </button>

          <button type="submit" disabled={loading} className={`w-full py-3.5 text-white font-medium rounded-xl text-sm shadow-md transition-colors ${isEditing ? 'bg-amber-700 hover:bg-amber-800' : 'bg-slate-900 hover:bg-slate-800'}`}>
            {loading ? 'Syncing Engine Matrix...' : isEditing ? 'Save Updates & Broadcast Changes' : 'Deploy Multi-Day Portal & Dispatch Link'}
          </button>
        </form>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">Active Deployed Links Directory</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {itineraries.map((trip) => (
              <div key={trip.id} className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white">
                <div>
                  <h3 className="font-medium text-sm text-slate-900">{trip.client_name} — <span className="text-slate-500 font-normal">{trip.destination}</span></h3>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">UUID: {trip.id} • {trip.trip_data?.length || 1} Days Planned</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEditing(trip)} className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-200 text-xs font-medium rounded-lg hover:bg-amber-100">✏️ Edit Plan</button>
                  <button onClick={() => window.open(`/?id=${trip.id}`, '_blank')} className="px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200">👁️ View Portal</button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}