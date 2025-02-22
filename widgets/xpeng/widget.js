document.addEventListener('DOMContentLoaded', (event) => {
  console.log('Widget loaded, initializing data fetch and polling...');
  updateData(); // Initial data fetch
  startPolling(9); // Start polling every 5 minutes
});
