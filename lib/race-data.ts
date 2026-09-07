// Confirmed event fees. Payment stays closed until the organiser activates the
// Suratgarh payment configuration with the real QR, payee and UPI address.
export const RACE_FEES: Record<string, number> = {
  '5': 399,
  '10': 499,
  '21': 499,
};
export const RACES = [
  {
    distance: '5',
    name: 'Fun Run',
    fee: 399,
    description:
      'A welcoming start for new runners and families. Find your pace and enjoy the morning together.',
    label: 'START TOGETHER',
    detail: 'Run or walk · Family friendly',
  },
  {
    distance: '10',
    name: 'Challenge Run',
    fee: 499,
    description:
      'For regular runners ready to go a little further. Set yourself a goal and make every kilometre count.',
    label: 'BUILD YOUR DISTANCE',
    detail: 'For regular runners',
  },
  {
    distance: '21',
    name: 'Half Marathon',
    fee: 499,
    description:
      'A rewarding endurance challenge for prepared runners. Bring your training to the start line.',
    label: 'GO THE DISTANCE',
    detail: 'For trained distance runners',
  },
];
