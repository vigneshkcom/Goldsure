export const year = 2026;
export const months = [
  { name: "December 2026", month: 12, days: 31 }
];

export const dailyLimits = { Gurdip: 6, Alex: 13, Mason: 9 };

export const availability = {
  "12-1":["Gurdip","Mason"],
  "12-2":["Gurdip"],
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
