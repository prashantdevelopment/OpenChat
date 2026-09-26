import { v2 as cloudinary } from "cloudinary";

// Stores each file in Cloudinary as <folder>/<id>:
// - resource_type "raw": the bytes are encrypted, not an image Cloudinary
//   could resize or convert, so they are kept exactly as uploaded;
// - type "authenticated": no public link works; the server reads them back
//   with a signed URL. (Encrypted anyway; this is a second layer.)
const createCloudinaryStorage = ({ cloudName, apiKey, apiSecret, folder }) => {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    const options = { resource_type: "raw", type: "authenticated" };
    const publicId = (id) => `${folder}/${id}`;

    return {
        save: (id, bytes) => new Promise((resolve, reject) => {
            const upload = cloudinary.uploader.upload_stream(
                // asset_folder: the folder shown in the Cloudinary console.
                { ...options, public_id: publicId(id), asset_folder: folder, overwrite: false },
                (err, result) => (err ? reject(new Error(`Cloudinary upload failed: ${err.message}`)) : resolve(result))
            );
            upload.end(bytes);
        }),

        read: async (id) => {
            const url = cloudinary.url(publicId(id), { ...options, sign_url: true });
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Cloudinary download failed: HTTP ${res.status}`);
            }
            return Buffer.from(await res.arrayBuffer());
        },

        remove: async (id) => {
            await cloudinary.uploader.destroy(publicId(id), { ...options, invalidate: true });
        },
    };
};

export default createCloudinaryStorage;
