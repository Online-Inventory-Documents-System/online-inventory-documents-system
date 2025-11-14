// client/js/setting.js
// Global configuration for the Online Inventory & Documents System

const CONFIG = {
    /* ================================
       Local Storage Keys
    =================================*/
    LS_THEME: 'systemTheme', // Used to remember Dark/Light mode


    /* ================================
       Security & Authentication
       (Note: Real security validation is done on backend)
    =================================*/
    
    // SECURITY_CODE is used only for:
    // - UI validation before sending request
    // - Displaying guidelines to the user
    //
    // The server RE-VALIDATES the real security code.
    
    SECURITY_CODE_HINT: 'Contact admin if you forgot.',

    /* Default admin shown only on first run UI
       These values DO NOT authenticate users. */
    DEFAULT_ADMIN_USER: 'admin',
    DEFAULT_ADMIN_PASS_HINT: '(set by admin)',  


    /* ================================
       Contact & UI Display
    =================================*/
    CONTACT_PHONE: '011-3312-7622', // Support contact for login page


    /* ================================
       System General Info
    =================================*/
    SYSTEM_NAME: 'Online Inventory & Documents System',
    VERSION: '2.0 (Final)',
};

  
/* ================================
   Apply saved theme automatically
=================================*/

(function applySavedTheme() {
    const savedTheme = localStorage.getItem(CONFIG.LS_THEME);
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
})();
