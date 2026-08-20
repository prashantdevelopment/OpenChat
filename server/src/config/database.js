import mongoose from "mongoose";
import { MONGO_URI } from "./env.js";

const connectDatabase = async () => {
    try {
        await mongoose.connect(MONGO_URI) 
        console.log("MongoDB Connected Successfully");
        
    }catch(err){
        console.log("Error connecting to MongoDB:", err);
        throw err;
        
    }

}

export default connectDatabase;