export const year = 2026;
export const months = [
  { name: "November 2026", month: 11, days: 30 },
  { name: "December 2026", month: 12, days: 31 }
];

export const areaSearchStartDate = '2026-11-23';

export const dailyLimits = { Gurdip: 6, Alex: 13, Mason: 11 };

// Mason has three bookings on 30 November: offer one more before 2 December.
export const bookingPriorities = {
  '2026-11-30/Mason': { rank: 0, limit: 4, southGoldCoast: true },
  '2026-12-02/Mason': { rank: 1, southGoldCoast: true },
  '2026-11-26/Josh': { rank: 2, limit: 5, batteryOnly: true },
  '2026-11-26/Gurdip': { rank: 3, batteryOnly: true },
  '2026-11-27/Gurdip': { rank: 4, batteryOnly: true }
};

export const bookingRule = (date, name) => bookingPriorities[date + '/' + name];
export const bookingLimit = (date, name) => bookingRule(date, name)?.limit ?? dailyLimits[name];

export const availability = {
  // November
  "11-23":["Gurdip"],
  "11-24":["Gurdip","Alex"],
  "11-25":["Gurdip"],
  "11-26":["Gurdip","Alex","Josh"],
  "11-27":["Gurdip","Josh"],
  "11-30":["Gurdip","Mason"],
  // December
  "12-1":["Gurdip"],
  "12-2":["Gurdip","Mason"],
  "12-3":["Gurdip","Alex"],
  "12-4":["Gurdip"],
  "12-7":["Gurdip","Alex","Mason"],
  "12-8":["Gurdip","Alex","Mason"],
  "12-9":["Gurdip"],
  "12-10":["Gurdip"],
  "12-11":["Gurdip","Alex"],
  "12-12":"TBC",
  "12-14":["Gurdip","Alex","Mason"],
  "12-15":["Gurdip","Mason"],
  "12-16":["Gurdip","Mason"],
  "12-17":["Gurdip"],
  "12-18":["Gurdip","Alex"],
  "12-19":"TBC",
  "12-21":"TBC","12-22":"TBC","12-23":"TBC","12-24":"TBC",
  "12-25":"Closed","12-26":"Closed",
  "12-28":"TBC","12-29":"TBC","12-30":"TBC","12-31":"TBC"
};

export const dateKey = (month, day) =>
  [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');

export const availableDates = Object.entries(availability)
  .filter(([, electricians]) => Array.isArray(electricians))
  .map(([day, electricians]) => ({ date: dateKey(...day.split('-')), electricians }))
  .sort((a, b) => a.date.localeCompare(b.date));

