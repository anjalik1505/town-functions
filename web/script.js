// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBP8FhUtJAG-yr-msuFQ0QxTajhYWituM4",
    authDomain: "village-staging-9178d.firebaseapp.com",
    projectId: "village-staging-9178d",
    storageBucket: "village-staging-9178d.firebasestorage.app",
    messagingSenderId: "263854518938",
    appId: "1:263854518938:web:04dd8bdb6647a83205e523",
    measurementId: "G-J6CMQEDYJF"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const signInButton = document.getElementById('sign-in-button');
    const submitButton = document.getElementById('submit-button');
    const updateTextarea = document.getElementById('update');
    const updateSentimentTextarea = document.getElementById('update-sentiment');
    const promptTextarea = document.getElementById('prompt');

    // Content textareas
    const summaryTextarea = document.getElementById('summary');
    const suggestionsTextarea = document.getElementById('suggestions');
    const emotionalOverviewTextarea = document.getElementById('emotional-overview');
    const keyMomentsTextarea = document.getElementById('key-moments');
    const recurringThemesTextarea = document.getElementById('recurring-themes');
    const progressAndGrowthTextarea = document.getElementById('progress-and-growth');

    // Auto-resize function for textareas
    function autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
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
        progressAndGrowthTextarea
    ];

    allTextareas.forEach(textarea => {
        textarea.addEventListener('input', () => autoResize(textarea));
        // Initial resize
        autoResize(textarea);
    });

    // Auth state observer
    auth.onAuthStateChanged((user) => {
        if (user) {
            signInButton.textContent = 'Refresh Token';
            submitButton.disabled = false;
        } else {
            signInButton.textContent = 'Sign in with Google';
            submitButton.disabled = true;
        }
    });

    // Sign in/refresh token handler
    signInButton.addEventListener('click', async () => {
        if (auth.currentUser) {
            // Force token refresh
            await auth.currentUser.getIdToken(true);
        } else {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        }
    });

    // Submit handler
    submitButton.addEventListener('click', async () => {
        try {
            const token = await auth.currentUser.getIdToken();

            // Get values from all textareas
            const data = {
                summary: summaryTextarea.value,
                suggestions: suggestionsTextarea.value,
                emotional_overview: emotionalOverviewTextarea.value,
                key_moments: keyMomentsTextarea.value,
                recurring_themes: recurringThemesTextarea.value,
                progress_and_growth: progressAndGrowthTextarea.value,
                update_content: updateTextarea.value,
                update_sentiment: updateSentimentTextarea.value,
                prompt: promptTextarea.value
            };

            // Make API call
            const response = await fetch('/test/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error('API call failed');
            }

            const result = await response.json();

            // Update content boxes with the response
            summaryTextarea.value = result.summary || '';
            suggestionsTextarea.value = result.suggestions || '';
            emotionalOverviewTextarea.value = result.emotional_overview || '';
            keyMomentsTextarea.value = result.key_moments || '';
            recurringThemesTextarea.value = result.recurring_themes || '';
            progressAndGrowthTextarea.value = result.progress_and_growth || '';
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred. Please try again.');
        }
    });
}); 