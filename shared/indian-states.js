// The 28 states and 8 union territories of India.
// Shared by the server (validation) and the client (dropdown), so both
// always use the same list. `code` is what gets stored in the database;
// `unionTerritory` only groups the dropdown.
export const INDIAN_STATES = [
    // States
    { code: "andhra-pradesh", name: "Andhra Pradesh" },
    { code: "arunachal-pradesh", name: "Arunachal Pradesh" },
    { code: "assam", name: "Assam" },
    { code: "bihar", name: "Bihar" },
    { code: "chhattisgarh", name: "Chhattisgarh" },
    { code: "goa", name: "Goa" },
    { code: "gujarat", name: "Gujarat" },
    { code: "haryana", name: "Haryana" },
    { code: "himachal-pradesh", name: "Himachal Pradesh" },
    { code: "jharkhand", name: "Jharkhand" },
    { code: "karnataka", name: "Karnataka" },
    { code: "kerala", name: "Kerala" },
    { code: "madhya-pradesh", name: "Madhya Pradesh" },
    { code: "maharashtra", name: "Maharashtra" },
    { code: "manipur", name: "Manipur" },
    { code: "meghalaya", name: "Meghalaya" },
    { code: "mizoram", name: "Mizoram" },
    { code: "nagaland", name: "Nagaland" },
    { code: "odisha", name: "Odisha" },
    { code: "punjab", name: "Punjab" },
    { code: "rajasthan", name: "Rajasthan" },
    { code: "sikkim", name: "Sikkim" },
    { code: "tamil-nadu", name: "Tamil Nadu" },
    { code: "telangana", name: "Telangana" },
    { code: "tripura", name: "Tripura" },
    { code: "uttar-pradesh", name: "Uttar Pradesh" },
    { code: "uttarakhand", name: "Uttarakhand" },
    { code: "west-bengal", name: "West Bengal" },
    // Union territories
    { code: "andaman-and-nicobar-islands", name: "Andaman and Nicobar Islands", unionTerritory: true },
    { code: "chandigarh", name: "Chandigarh", unionTerritory: true },
    { code: "dadra-nagar-haveli-daman-diu", name: "Dadra and Nagar Haveli and Daman and Diu", unionTerritory: true },
    { code: "delhi", name: "Delhi", unionTerritory: true },
    { code: "jammu-and-kashmir", name: "Jammu and Kashmir", unionTerritory: true },
    { code: "ladakh", name: "Ladakh", unionTerritory: true },
    { code: "lakshadweep", name: "Lakshadweep", unionTerritory: true },
    { code: "puducherry", name: "Puducherry", unionTerritory: true },
];

export const INDIAN_STATE_CODES = INDIAN_STATES.map((state) => state.code);
