import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function AgentDashboard() {
  const [itineraries, setItineraries] = useState([]);
  const [clientName, setClientName] = useState('');
  const [destination, setDestination] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [coverImage, setCoverImage] = useState('');

  // Group Companions State
  const [groupMembers, setGroupMembers] = useState([]);

  // Multi-Day Initial State
  const [tripDays, setTripDays] = useState([
    {
      dayTitle: "Day 1: Arrival & Exploration",
      activities: [
        { 
          time: "12:00", 
          title: "", 
          address: "", 
          lat: null, 
          lng: null, 
          placeImage: "", 
          description: "", 
          is_driving_route: true,
          ticketName: "",
          ticketUrl: ""
        }
      ]
    }
  ]);

  const [destSuggestions, setDestSuggestions] = useState([]); 
  const [activitySuggestions, setActivitySuggestions] = useState({}); 

  const [isEditing, setIsEditing] = useState(false);
  const [editingTripId, setEditingTripId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { 
    fetchItineraries();

    const channel = supabase
      .channel('realtime:agent_telemetry')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itineraries' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            setItineraries((prev) => 
              prev.map((item) => item.id === payload.new.id ? { ...item, ...payload.new } : item)
            );
          } else {
            fetchItineraries();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchItineraries() {
    const { data } = await supabase.from('itineraries').select('*').order('created_at', { ascending: false });
    if (data) setItineraries(data);
  }

  const deleteItinerary = async (tripId, client) => {
    const confirmed = window.confirm(`Are you sure you want to permanently delete the itinerary for "${client}"?`);
    if (!confirmed) return;

    const { error } = await supabase.from('itineraries').delete().eq('id', tripId);
    if (!error) {
      setItineraries((prev) => prev.filter((item) => item.id !== tripId));
      if (isEditing && editingTripId === tripId) {
        cancelEditing();
      }
    } else {
      alert(`Error deleting itinerary: ${error.message}`);
    }
  };

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

  const addNewDay = () => {
    const nextDayNum = tripDays.length + 1;
    setTripDays([
      ...tripDays,
      {
        dayTitle: `Day ${nextDayNum}: Sightseeing & Highlights`,
        activities: [
          { 
            time: "09:00", 
            title: "", 
            address: "", 
            lat: null, 
            lng: null, 
            placeImage: "", 
            description: "", 
            is_driving_route: true,
            ticketName: "",
            ticketUrl: ""
          }
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
    updatedDays[dayIndex].activities.push({ 
      time: "14:00", 
      title: "", 
      address: "", 
      lat: null, 
      lng: null, 
      placeImage: "", 
      description: "", 
      is_driving_route: true,
      ticketName: "",
      ticketUrl: ""
    });
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

  const addGroupMember = () => {
    setGroupMembers([...groupMembers, { id: Date.now().toString(), name: '', phone: '' }]);
  };

  const removeGroupMember = (idx) => {
    setGroupMembers(groupMembers.filter((_, i) => i !== idx));
  };

  const updateGroupMember = (idx, field, value) => {
    const copy = [...groupMembers];
    copy[idx][field] = value;
    setGroupMembers(copy);
  };

  const generateCatchyDescription = async (title, dIdx, aIdx) => {
    if (!title || title.trim().length === 0) {
      return alert('Enter a place name first!');
    }

    const cleanTitle = title.trim();
    updateActivityField(dIdx, aIdx, 'description', '✨ Generating detailed place intelligence...');

    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTitle)}`
      );

      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        if (wikiData.extract && wikiData.extract.length > 50) {
          const detailedText = `${wikiData.extract} Known as a must-visit highlight of the region, offering visitors a rich blend of cultural heritage and captivating atmosphere.`;
          updateActivityField(dIdx, aIdx, 'description', detailedText);
          return;
        }
      }

      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTitle)}&format=json&origin=*`
      );
      const searchData = await searchRes.json();

      if (searchData.query?.search?.length > 0) {
        const topSnippet = searchData.query.search[0].snippet.replace(/<\/?[^>]+(>|$)/g, "");
        if (topSnippet.length > 40) {
          const formatted = `${topSnippet}. Step into this iconic spot to immerse yourself in the authentic character and architectural charm that defines the destination.`;
          updateActivityField(dIdx, aIdx, 'description', formatted);
          return;
        }
      }
    } catch (e) {
      console.warn('Live encyclopedia fetch fallback:', e);
    }

    const lower = cleanTitle.toLowerCase();
    let richFallback = '';

    if (lower.includes('temple') || lower.includes('church') || lower.includes('mosque') || lower.includes('cathedral')) {
      richFallback = `An ancient and revered sanctuary renowned for its striking architectural grandeur, sacred tranquility, and profound spiritual significance. Visitors can admire intricate artisanal carvings and experience centuries of timeless devotion.`;
    } else if (lower.includes('beach') || lower.includes('island') || lower.includes('lake') || lower.includes('falls') || lower.includes('river')) {
      richFallback = `A serene coastal and natural escape celebrated for its scenic vistas, gentle breezes, and relaxing atmosphere. Ideal for unwinding, taking in golden hour views, and exploring authentic local shoreline culture.`;
    } else if (lower.includes('fort') || lower.includes('palace') || lower.includes('museum') || lower.includes('monument')) {
      richFallback = `A historic landmark standing as a testament to monumental heritage, strategic defense, and royal opulence. Explore its vast courtyards, historical galleries, and legendary stories etched into every corridor.`;
    } else if (lower.includes('market') || lower.includes('bazaar') || lower.includes('street') || lower.includes('mall')) {
      richFallback = `A vibrant and energetic hub brimming with local trade, artisanal crafts, aromatic regional delicacies, and lively street life. The ultimate stop for authentic shopping and discovering indigenous flavors.`;
    } else {
      richFallback = `A curated, premier destination in ${cleanTitle} blending distinctive local character, scenic panoramas, and memorable exploratory experiences designed for curious travelers.`;
    }

    updateActivityField(dIdx, aIdx, 'description', richFallback);
  };

  const startEditing = (trip) => {
    setIsEditing(true);
    setEditingTripId(trip.id);
    setClientName(trip.client_name);
    setDestination(trip.destination);
    setWhatsapp(trip.whatsapp_number || '');
    setDepartureDate(trip.departure_date || '');
    setCoverImage(trip.cover_image || '');
    setTripDays(trip.trip_data || []);
    setGroupMembers(trip.group_members || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditingTripId(null);
    setClientName(''); setDestination(''); setWhatsapp(''); setDepartureDate(''); setCoverImage('');
    setGroupMembers([]);
    setTripDays([{ dayTitle: "Day 1: Arrival & Exploration", activities: [{ time: "12:00", title: "", address: "", lat: null, lng: null, placeImage: "", description: "", is_driving_route: true, ticketName: "", ticketUrl: "" }] }]);
  };

  const triggerDispatchLink = (id, phone, name, dest, isLead = true) => {
    const cleanNumber = phone.replace(/\D/g, '');
    const roleParam = isLead ? 'lead' : 'member';
    const liveUrl = `${window.location.origin}/?id=${id}&role=${roleParam}`;
    const roleText = isLead ? "Trip Leader Portal" : "Companion Portal";
    const message = encodeURIComponent(
      `Hello ${name}! ✨ Here is your access link to the ${dest} trip (${roleText}): ${liveUrl}`
    );
    window.open(`https://wa.me/${cleanNumber}?text=${message}`, '_blank');
  };

  const calculateTelemetry = (trip) => {
    let totalStops = 0;
    let completedStops = 0;
    let currentActiveStop = null;
    const visited = trip.visited_stops || {};

    trip.trip_data?.forEach((day, dIdx) => {
      day.activities?.forEach((act, aIdx) => {
        totalStops++;
        const key = `${dIdx}-${aIdx}`;
        if (visited[key]) {
          completedStops++;
        } else if (!currentActiveStop && act.lat && act.lng) {
          currentActiveStop = { ...act, dayTitle: day.dayTitle };
        }
      });
    });

    const percentage = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;
    return { totalStops, completedStops, percentage, currentActiveStop };
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
      group_members: groupMembers
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
      if (whatsapp) {
        triggerDispatchLink(data[0].id, whatsapp, clientName, destination, true);
      }
      cancelEditing();
      fetchItineraries();
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#F4F4F0] p-3 sm:p-6 font-sans overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* RESPONSIVE HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center gap-3">
            <img 
              src="/logo.png" 
              alt="RouteFlow Logo" 
              className="w-9 h-9 sm:w-10 sm:h-10 object-contain rounded-xl shrink-0"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div>
              <h1 className="font-editorial text-2xl sm:text-3xl text-slate-900 tracking-tight leading-tight">RouteFlow</h1>
              <p className="text-[11px] sm:text-xs text-slate-500">Multi-Day Travel Planner & Agency Command</p>
            </div>
          </div>
          {isEditing && (
            <button 
              type="button" 
              onClick={cancelEditing} 
              className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition-colors"
            >
              Cancel Edit Mode
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* CORE TRIP INFO */}
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200/60 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 relative z-40">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 font-mono">Trip Lead Name</label>
              <input 
                type="text" 
                placeholder="Client Name (e.g. John Doe)" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)} 
                className="px-3.5 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-xs sm:text-sm w-full focus:outline-slate-900" 
              />
            </div>
            
            <div className="space-y-1 relative">
              <label className="text-[11px] font-bold text-slate-600 font-mono">City / Destination</label>
              <input 
                type="text" 
                placeholder="Type City (e.g. Madurai)" 
                value={destination} 
                onChange={(e) => setDestination(e.target.value)} 
                className="px-3.5 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-xs sm:text-sm w-full focus:outline-slate-900" 
              />
              {destSuggestions && destSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-50 text-xs divide-y divide-slate-100">
                  {destSuggestions.map((item, idx) => (
                    <div key={idx} onClick={() => selectDestination(item)} className="p-3 hover:bg-slate-50 cursor-pointer text-slate-700 font-medium truncate">
                      📍 {item.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 font-mono">Lead WhatsApp (+91...)</label>
              <input 
                type="text" 
                placeholder="+91 9876543210" 
                value={whatsapp} 
                onChange={(e) => setWhatsapp(e.target.value)} 
                className="px-3.5 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-xs sm:text-sm w-full focus:outline-slate-900" 
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 font-mono">Departure Date</label>
              <input 
                type="date" 
                value={departureDate} 
                onChange={(e) => setDepartureDate(e.target.value)} 
                className="px-3.5 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-600 w-full focus:outline-slate-900" 
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-bold text-slate-600 font-mono">Cover Image URL (Optional)</label>
              <input 
                type="text" 
                placeholder="https://images.unsplash.com/..." 
                value={coverImage} 
                onChange={(e) => setCoverImage(e.target.value)} 
                className="px-3.5 py-2.5 bg-[#FAF9F6] border border-slate-200 rounded-xl text-xs sm:text-sm w-full focus:outline-slate-900" 
              />
            </div>
          </div>

          {/* GROUP COMPANIONS ROSTER */}
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200/60 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-3">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">👥 Group Companions Roster</h3>
                <p className="text-[11px] text-slate-500">Add group members to receive synchronized live views.</p>
              </div>
              <button 
                type="button" 
                onClick={addGroupMember}
                className="self-start sm:self-auto text-xs font-bold px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors font-mono"
              >
                + Add Member
              </button>
            </div>

            {groupMembers.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">No companions added. Solo lead mode active.</p>
            ) : (
              <div className="space-y-2.5">
                {groupMembers.map((member, mIdx) => (
                  <div key={member.id || mIdx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center bg-[#FAF9F6] p-3 rounded-xl border border-slate-200">
                    <input 
                      type="text" 
                      placeholder="Companion Name" 
                      value={member.name} 
                      onChange={(e) => updateGroupMember(mIdx, 'name', e.target.value)}
                      className="p-2 border rounded-lg text-xs bg-white text-slate-700 w-full" 
                    />
                    <input 
                      type="text" 
                      placeholder="Companion WhatsApp (+91...)" 
                      value={member.phone} 
                      onChange={(e) => updateGroupMember(mIdx, 'phone', e.target.value)}
                      className="p-2 border rounded-lg text-xs bg-white text-slate-700 w-full" 
                    />
                    <div className="flex justify-end">
                      <button 
                        type="button" 
                        onClick={() => removeGroupMember(mIdx)}
                        className="text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DYNAMIC MULTI-DAY TIMELINE */}
          {tripDays.map((day, dIdx) => (
            <div key={dIdx} className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200/60 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-dashed border-slate-300 pb-2">
                <input 
                  type="text" 
                  value={day.dayTitle} 
                  onChange={(e) => {
                    const copy = [...tripDays]; 
                    copy[dIdx].dayTitle = e.target.value; 
                    setTripDays(copy);
                  }} 
                  className="font-editorial text-lg sm:text-xl text-slate-800 focus:outline-none w-full bg-transparent font-bold" 
                />
                {tripDays.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => removeDay(dIdx)}
                    className="text-[11px] sm:text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded bg-rose-50 shrink-0"
                  >
                    🗑️ Delete Day
                  </button>
                )}
              </div>
              
              <div className="space-y-3.5">
                {day.activities && day.activities.map((act, aIdx) => {
                  const sKey = `${dIdx}-${aIdx}`;
                  const currentSuggestions = activitySuggestions[sKey] || [];
                  
                  return (
                    <div key={aIdx} className="p-3.5 sm:p-4 bg-[#FAF9F6] rounded-xl border border-slate-200 space-y-3">
                      
                      {/* Top Row: Time, Place & Action */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center">
                        <input 
                          type="time" 
                          value={act.time} 
                          onChange={(e) => updateActivityField(dIdx, aIdx, 'time', e.target.value)} 
                          className="p-2 border rounded-lg text-xs bg-white text-slate-700 w-full" 
                        />
                        
                        <div className="relative w-full">
                          <input 
                            type="text" 
                            placeholder="Type Landmark / Place" 
                            value={act.title} 
                            onChange={(e) => handlePlaceInputChange(dIdx, aIdx, e.target.value)} 
                            className="p-2 border rounded-lg text-xs bg-white w-full focus:outline-slate-900"
                          />
                          {currentSuggestions && currentSuggestions.length > 0 && (
                            <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-40 overflow-y-auto z-50 text-xs divide-y divide-slate-100">
                              {currentSuggestions.map((item, idx) => (
                                <div key={idx} onClick={() => selectActivityAddress(dIdx, aIdx, item)} className="p-2.5 hover:bg-slate-50 cursor-pointer text-slate-700 truncate font-medium">
                                  ✨ {item.display_name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button 
                            type="button" 
                            onClick={() => generateCatchyDescription(act.title, dIdx, aIdx)} 
                            className="text-[10px] px-2.5 py-1.5 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition-colors shrink-0"
                          >
                            ✨ AI Summary
                          </button>
                          <button 
                            type="button" 
                            onClick={() => removeActivity(dIdx, aIdx)} 
                            className="text-[10px] text-slate-400 hover:text-rose-600"
                          >
                            ✕ Delete
                          </button>
                        </div>
                      </div>

                      {/* Transport Mode & Image URL */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                          <span className="text-[11px] font-bold text-slate-500 shrink-0">Route:</span>
                          <select 
                            value={act.is_driving_route ?? true ? "driving" : "flight"}
                            onChange={(e) => updateActivityField(dIdx, aIdx, 'is_driving_route', e.target.value === "driving")}
                            className="text-xs bg-transparent font-medium text-slate-800 focus:outline-none w-full cursor-pointer"
                          >
                            <option value="driving">🚗 Road / Highway Route</option>
                            <option value="flight">✈️ Flight Route (Dashed)</option>
                          </select>
                        </div>

                        <input 
                          type="text" 
                          placeholder="Place Image URL (Optional)" 
                          value={act.placeImage || ''} 
                          onChange={(e) => updateActivityField(dIdx, aIdx, 'placeImage', e.target.value)}
                          className="w-full p-2 border rounded-lg text-xs bg-white focus:outline-slate-900"
                        />
                      </div>

                      {/* Travel Pass Vault Inputs */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-amber-50/50 p-2.5 rounded-lg border border-amber-100/80">
                        <input 
                          type="text" 
                          placeholder="🎟️ Pass Reference (e.g. VIP #TK-102)" 
                          value={act.ticketName || ''} 
                          onChange={(e) => updateActivityField(dIdx, aIdx, 'ticketName', e.target.value)}
                          className="p-2 border border-amber-200/80 rounded-lg text-xs bg-white focus:outline-slate-900 w-full"
                        />
                        <input 
                          type="text" 
                          placeholder="📄 Pass / QR Document URL" 
                          value={act.ticketUrl || ''} 
                          onChange={(e) => updateActivityField(dIdx, aIdx, 'ticketUrl', e.target.value)}
                          className="p-2 border border-amber-200/80 rounded-lg text-xs bg-white focus:outline-slate-900 w-full"
                        />
                      </div>

                      {act.address && (
                        <div className="text-[10px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100 font-mono truncate">
                          📍 Locked: {act.lat?.toFixed(4)}, {act.lng?.toFixed(4)}
                        </div>
                      )}

                      <textarea 
                        placeholder="Itinerary description details..." 
                        value={act.description} 
                        onChange={(e) => updateActivityField(dIdx, aIdx, 'description', e.target.value)} 
                        className="w-full p-2.5 border rounded-lg text-xs bg-white h-16 resize-none focus:outline-slate-900" 
                      />
                    </div>
                  );
                })}
              </div>

              <button 
                type="button" 
                onClick={() => addActivity(dIdx)} 
                className="text-xs font-bold text-amber-800 hover:text-amber-900 block"
              >
                + Add Stop Card to {day.dayTitle.split(':')[0]}
              </button>
            </div>
          ))}

          <button 
            type="button" 
            onClick={addNewDay}
            className="w-full py-3 bg-white border-2 border-dashed border-slate-300 hover:border-slate-400 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-2xl transition-colors font-mono"
          >
            + Add New Day to Itinerary
          </button>

          <button 
            type="submit" 
            disabled={loading} 
            className={`w-full py-3.5 text-white font-medium rounded-xl text-sm shadow-md transition-colors ${isEditing ? 'bg-amber-700 hover:bg-amber-800' : 'bg-slate-900 hover:bg-slate-800'}`}
          >
            {loading ? 'Deploying Engine...' : isEditing ? 'Save & Broadcast Updates' : 'Deploy Multi-Day Portal & Generate Link'}
          </button>
        </form>

        {/* ACTIVE DEPLOYED DIRECTORY */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Active Deployed Links & Telemetry</h2>
            <span className="self-start sm:self-auto flex items-center gap-1.5 text-[10px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Sync Stream Active
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {itineraries.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 font-mono">
                No active deployed itineraries found.
              </div>
            ) : (
              itineraries.map((trip) => {
                const telemetry = calculateTelemetry(trip);

                return (
                  <div key={trip.id} className="p-4 sm:p-5 flex flex-col gap-3.5 bg-white">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-1.5 flex-wrap">
                          {trip.client_name} — <span className="text-slate-500 font-normal">{trip.destination}</span>
                          {telemetry.percentage === 100 && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-mono font-bold">🎉 Complete</span>
                          )}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {trip.trip_data?.length || 1} Days Planned • {trip.group_members?.length || 0} Companions
                        </p>
                      </div>

                      {/* RESPONSIVE BUTTON ROW */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={() => startEditing(trip)} className="px-2.5 py-1.5 bg-amber-50 text-amber-900 border border-amber-200 text-xs font-medium rounded-lg">✏️ Edit</button>
                        <button onClick={() => window.open(`/?id=${trip.id}&role=lead`, '_blank')} className="px-2.5 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg">👑 Lead</button>
                        <button onClick={() => window.open(`/?id=${trip.id}&role=member`, '_blank')} className="px-2.5 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg">👥 Member</button>
                        <button onClick={() => deleteItinerary(trip.id, trip.client_name)} className="px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium rounded-lg">🗑️</button>
                      </div>
                    </div>

                    {/* TELEMETRY BAR */}
                    <div className="bg-[#FAF9F6] p-3 rounded-xl border border-slate-200/80 space-y-1.5">
                      <div className="flex justify-between items-center text-xs font-mono">
                        <span className="text-slate-700 font-bold">Live Progress: <span className="text-blue-600">{telemetry.completedStops}/{telemetry.totalStops}</span></span>
                        <span className="text-slate-500 font-bold">{telemetry.percentage}%</span>
                      </div>

                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500 rounded-full"
                          style={{ width: `${telemetry.percentage}%` }}
                        />
                      </div>

                      <div className="text-[10px] font-mono text-slate-600 truncate pt-0.5">
                        {telemetry.currentActiveStop ? (
                          <span>📍 Target: <b>{telemetry.currentActiveStop.title}</b> ({telemetry.currentActiveStop.time})</span>
                        ) : (
                          <span className="text-emerald-700 font-semibold">🏁 All stops visited</span>
                        )}
                      </div>
                    </div>

                    {/* COMPANIONS DISPATCH */}
                    {trip.group_members && trip.group_members.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center pt-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">WhatsApp:</span>
                        {trip.group_members.map((member, mIdx) => (
                          <button
                            key={mIdx}
                            onClick={() => triggerDispatchLink(trip.id, member.phone, member.name, trip.destination, false)}
                            className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-mono"
                          >
                            📲 {member.name || `Member ${mIdx + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}