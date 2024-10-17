// UI Class to handle all DOM-related changes
class UI {
    constructor() {
      // Fetching references to UI elements by their ID
      this.fetchButton = document.getElementById("fetch-data");
      this.output = document.getElementById("output");
      this.progressContainer = document.getElementById("progress-container");
      this.progressBar = document.getElementById("progress-bar");
      this.progressText = document.getElementById("progress-text");
      this.connectionStatus = document.getElementById("connection-status");
    }
  
    // Method to update the connection status display in the UI
    setConnectionStatus(connected) {
      const dot = this.connectionStatus.querySelector(".status-dot");
      const text = this.connectionStatus.querySelector(".status-text");
  
      // Toggle between connected/disconnected status
      dot.className = `status-dot ${connected ? "connected" : "disconnected"}`;
      text.textContent = connected ? "Connected to Prusa Connect" : "Not connected";
    }
  
    // Enable the fetch button when connected to Prusa Connect
    enableFetchButton() {
      this.fetchButton.disabled = false;
    }
  
    // Start the fetching process, display progress bar
    startFetching() {
      this.fetchButton.disabled = true;
      this.progressContainer.style.display = "block";
      this.updateProgress(0); // Reset progress bar
    }
  
    // Stop the fetching process, hide progress bar
    stopFetching() {
      this.fetchButton.disabled = false;
      this.progressContainer.style.display = "none";
    }
  
    // Update the progress bar based on the percentage
    updateProgress(percent) {
      this.progressBar.style.width = `${percent}%`;
      this.progressText.textContent = `Fetching data... ${Math.round(percent)}%`;
    }
  
    // Display warning messages in the UI (orange color)
    showWarning(message) {
      this.output.textContent = message;
      this.output.className = "output warning"; // Apply 'warning' class for styling
    }
  
    // Display error messages in the UI (red color)
    showError(message) {
      this.output.textContent = message;
      this.output.className = "output error"; // Apply 'error' class for styling
    }
  
    // Display success messages in the UI (green color)
    showSuccess(message) {
      this.output.textContent = message;
      this.output.className = "output success"; // Apply 'success' class for styling
    }
  }
  
  // Class to handle data fetching and processing
  class PrusaDataFetcher {
    constructor(ui) {
      this.ui = ui;
      // Define limits for API requests
      this.PRINTERS_LIMIT = 50;
      this.JOBS_LIMIT = 1000;
      this.OFFSET = 0;
    }
  
    // Initialize the fetcher and check if the user is on the Prusa Connect page
    async initialize() {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentUrl = tabs[0]?.url || "";
  
      if (currentUrl.startsWith("https://connect.prusa3d.com/")) {
        // Connected to Prusa Connect
        this.ui.setConnectionStatus(true);
        this.ui.enableFetchButton();
        this.ui.showWarning("Waiting for extraction..."); // Display ready-to-fetch message
        this.setupEventListeners();
      } else {
        // Not connected to Prusa Connect
        this.ui.setConnectionStatus(false);
        this.ui.showError("Please navigate to Prusa Connect to use this extension.");
      }
    }
  
    // Set up the click event listener for the fetch button
    setupEventListeners() {
      this.ui.fetchButton.addEventListener("click", () => this.handleFetchData());
    }
  
    // Handle data fetching when the user clicks the "Extract Data" button
    async handleFetchData() {
      try {
        this.ui.startFetching(); // Start fetching process
        const printerData = await this.fetchAllPrinterData(); // Fetch printer data
        const zipBlob = await this.createZipFile(printerData); // Generate ZIP file
        await this.downloadZipFile(zipBlob); // Initiate file download
        this.ui.showSuccess("Data fetched and downloaded successfully!");
      } catch (error) {
        console.error("Error:", error); // Log error to console
        this.ui.showError(`Error: ${error.message}`); // Display error in UI
      } finally {
        this.ui.stopFetching(); // Stop fetching process
      }
    }
  
    // Fetch all printer data, including jobs for each printer
    async fetchAllPrinterData() {
      const printers = await this.fetchPrinters(); // Fetch list of printers
      return await this.fetchJobsForPrinters(printers); // Fetch jobs for each printer
    }
  
    // Fetch printers from Prusa Connect API
    async fetchPrinters() {
      const response = await fetch(
        `https://connect.prusa3d.com/app/printers?limit=${this.PRINTERS_LIMIT}&offset=${this.OFFSET}&sort_by=%2Bstate%2C%2Bname%2C%2Bremaining_time`,
        { credentials: "include" }
      );
  
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`); // Error handling
      const data = await response.json();
      return data.printers;
    }
  
    // Fetch jobs for each printer from the Prusa Connect API
    async fetchJobsForPrinters(printers) {
      const total = printers.length;
      const printerData = [];
  
      for (let i = 0; i < printers.length; i++) {
        const printer = printers[i];
        const jobs = await this.fetchPrinterJobs(printer.uuid); // Fetch jobs for the printer
        printerData.push({ printer, jobs });
  
        this.ui.updateProgress(((i + 1) / total) * 100); // Update progress bar
      }
  
      return printerData;
    }
  
    // Fetch jobs for a specific printer
    async fetchPrinterJobs(printerUUID) {
      const response = await fetch(
        `https://connect.prusa3d.com/app/printers/${printerUUID}/jobs?limit=${this.JOBS_LIMIT}&offset=${this.OFFSET}&state=FIN_OK&state=FIN_ERROR&state=FIN_STOPPED&state=UNKNOWN`,
        { credentials: "include" }
      );
  
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      return data.jobs;
    }
  
    // Create a ZIP file of printer jobs data
    async createZipFile(printerData) {
      const zip = new JSZip();
      const currentDate = this.getFormattedDate();
  
      printerData.forEach(({ printer, jobs }) => {
        const csvData = this.convertJobsToCSV(jobs); // Convert jobs data to CSV format
        const fileName = this.getSafeFileName(printer.name, currentDate); // Get a safe file name
        zip.file(fileName, csvData); // Add file to ZIP
      });
  
      return await zip.generateAsync({ type: "blob" }); // Return ZIP file blob
    }
  
    // Get the current date in a safe format (e.g., 10-10-2024)
    getFormattedDate() {
      const today = new Date();
      return today.toLocaleDateString("en-GB").replace(/\//g, "-");
    }
  
    // Get a safe file name for the CSV files by removing invalid characters
    getSafeFileName(printerName, date) {
      const safeName = printerName.replace(/[\/\\:*?"<>|]/g, "_");
      return `${safeName}_${date}.csv`;
    }
  
    // Convert job data to CSV format
    convertJobsToCSV(jobs) {
      const headers = [
        "Title",
        "Status",
        "Printing Time",
        "Material",
        "Print End",
        "Filament Usage (g)",
        "Path to Model",
      ];
  
      const rows = jobs.map((job) =>
        [
          job?.file?.display_name || "N/A",
          job.state || "N/A",
          job.time_printing || "N/A",
          job?.file?.meta?.filament_type || "N/A",
          job.end ? new Date(job.end * 1000).toLocaleString() : "N/A",
          job?.file?.meta?.filament_used_g || "N/A",
          job.path || "N/A",
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`)
      );
  
      return [headers.join(","), ...rows].join("\n");
    }
  
    // Trigger the file download of the ZIP file
    async downloadZipFile(blob) {
      const date = this.getFormattedDate();
      await chrome.downloads.download({
        url: URL.createObjectURL(blob),
        filename: `printer_jobs_history_${date}.zip`,
        saveAs: true,
      });
    }
  }
  
  // Initialize the application when the DOM is loaded
  document.addEventListener("DOMContentLoaded", () => {
    const ui = new UI(); // Instantiate the UI class
    const fetcher = new PrusaDataFetcher(ui); // Instantiate the fetcher class
    fetcher.initialize(); // Start the application
  });
  