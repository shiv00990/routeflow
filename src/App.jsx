import React from 'react';
import ClientPortal from './ClientPortal';
import AgentDashboard from './AgentDashboard';

export default function App() {
  // Read parameter tracking tokens out of the current location address bar
  const params = new URLSearchParams(window.location.search);
  const tripId = params.get('id');

  // If a client UUID parameter token is provided, isolate layout to the mobile view portal
  if (tripId) {
    return <ClientPortal tripId={tripId} />;
  }

  // Default fallback route loads the management control panel
  return <AgentDashboard />;
}