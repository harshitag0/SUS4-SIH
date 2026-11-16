const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const env = {
  port: num(process.env.PORT, 4000),
  mongo: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink",
  mlUrl: process.env.ML_URL || "http://127.0.0.1:8000",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  usdInr: num(process.env.USD_INR, 88),
  devOtp: process.env.DEV_OTP || "1234",
  seedOnStart: process.env.SEED_ON_START !== "false",
};
