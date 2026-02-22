const timestamp = () => new Date().toISOString();

export const info = (...args) => {
  console.log(`[${timestamp()}]`, ...args);
};

export const error = (...args) => {
  console.error(`[${timestamp()}]`, ...args);
};
