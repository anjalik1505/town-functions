// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBP8FhUtJAG-yr-msuFQ0QxTajhYWituM4",
  authDomain: "village-staging-9178d.firebaseapp.com",
  projectId: "village-staging-9178d",
  storageBucket: "village-staging-9178d.firebasestorage.app",
  messagingSenderId: "263854518938",
  appId: "1:263854518938:web:04dd8bdb6647a83205e523",
  measurementId: "G-J6CMQEDYJF",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const signInButton = document.getElementById("sign-in-button");
  const submitButton = document.getElementById("submit-button");
  const updateTextarea = document.getElementById("update");
  const updateSentimentTextarea = document.getElementById("update-sentiment");
  const promptTextarea = document.getElementById("prompt");
  const ownProfileToggle = document.getElementById("own-profile-toggle");
  const insightsSection = document.querySelector(".insights-section");
  const genderTextarea = document.getElementById("gender");
  const locationTextarea = document.getElementById("location");
  const temperatureInput = document.getElementById("temperature");

  // Content textareas
  const summaryTextarea = document.getElementById("summary");
  const suggestionsTextarea = document.getElementById("suggestions");
  const emotionalOverviewTextarea =
    document.getElementById("emotional-overview");
  const keyMomentsTextarea = document.getElementById("key-moments");
  const recurringThemesTextarea = document.getElementById("recurring-themes");
  const progressAndGrowthTextarea = document.getElementById(
    "progress-and-growth",
  );

  // Initialize insights section visibility and show it by default
  insightsSection.classList.add("visible");
  ownProfileToggle.checked = true; // Ensure toggle is checked programmatically

  // Toggle handler
  ownProfileToggle.addEventListener("change", () => {
    insightsSection.classList.toggle("visible", ownProfileToggle.checked);
  });

  // Auto-resize function for textareas
  function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  // Add input event listeners to all textareas
  const allTextareas = [
    updateTextarea,
    updateSentimentTextarea,
    promptTextarea,
    summaryTextarea,
    suggestionsTextarea,
    emotionalOverviewTextarea,
    keyMomentsTextarea,
    recurringThemesTextarea,
    progressAndGrowthTextarea,
  ];

  allTextareas.forEach((textarea) => {
    textarea.addEventListener("input", () => autoResize(textarea));
    // Initial resize
    autoResize(textarea);
  });

  // Auth state observer
  auth.onAuthStateChanged((user) => {
    if (user) {
      signInButton.textContent = "Refresh Token";
      submitButton.disabled = false;
    } else {
      signInButton.textContent = "Sign in with Google";
      submitButton.disabled = true;
    }
  });

  // Sign in/refresh token handler
  signInButton.addEventListener("click", async () => {
    if (auth.currentUser) {
      // Force token refresh
      await auth.currentUser.getIdToken(true);
    } else {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    }
  });

  // Submit handler
  submitButton.addEventListener("click", async () => {
    try {
      const token = await auth.currentUser.getIdToken();

      // Get values from all textareas
      const data = {
        summary: summaryTextarea.value,
        suggestions: suggestionsTextarea.value,
        update_content: updateTextarea.value,
        update_sentiment: updateSentimentTextarea.value,
        prompt: promptTextarea.value,
        is_own_profile: ownProfileToggle.checked,
      };

      // Add gender and location only if they have values
      if (genderTextarea.value.trim()) {
        data.gender = genderTextarea.value;
      }
      if (locationTextarea.value.trim()) {
        data.location = locationTextarea.value;
      }

      // Add temperature if it has a value
      if (temperatureInput.value) {
        const temp = parseFloat(temperatureInput.value);
        if (!isNaN(temp) && temp >= 0 && temp <= 2) {
          data.temperature = temp;
        } else {
          alert("Temperature must be a number between 0 and 2");
          return;
        }
      }

      // Only include insights data if it's own profile
      if (ownProfileToggle.checked) {
        data.emotional_overview = emotionalOverviewTextarea.value;
        data.key_moments = keyMomentsTextarea.value;
        data.recurring_themes = recurringThemesTextarea.value;
        data.progress_and_growth = progressAndGrowthTextarea.value;
      }

      // Make API call
      const response = await fetch(
        "https://api-jywgqzmk7a-uc.a.run.app/test/prompt",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        },
      );

      if (!response.ok) {
        throw new Error("API call failed");
      }

      const result = await response.json();

      // Update content boxes with the response
      summaryTextarea.value = result.summary || "";
      suggestionsTextarea.value = result.suggestions || "";
      if (result.emotional_overview)
        emotionalOverviewTextarea.value = result.emotional_overview;
      if (result.key_moments) keyMomentsTextarea.value = result.key_moments;
      if (result.recurring_themes)
        recurringThemesTextarea.value = result.recurring_themes;
      if (result.progress_and_growth)
        progressAndGrowthTextarea.value = result.progress_and_growth;
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    }
  });
});
