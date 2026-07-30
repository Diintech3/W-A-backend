const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://anilkumarsingh43425_db_user:uPUtiGrSzCue5xrN@cluster0.wkyihnb.mongodb.net/whatsapp-automation?retryWrites=true&w=majority&appName=Cluster0')
.then(async () => {
  const adminId = new mongoose.Types.ObjectId('6a6470b7898ec79989971155');
  const clientId = new mongoose.Types.ObjectId('6a6af2077cfed26717e2b8ef');
  
  // Clear admin's phone number ID so it doesn't conflict
  await mongoose.connection.collection('users').updateOne(
    { _id: adminId },
    { $set: { whatsappPhoneNumberId: '' } }
  );
  
  // Move conversations to client
  await mongoose.connection.collection('conversations').updateMany(
    { userId: adminId },
    { $set: { userId: clientId } }
  );
  
  // Move messages to client
  await mongoose.connection.collection('messages').updateMany(
    { userId: adminId },
    { $set: { userId: clientId } }
  );

  console.log('Fixed conflicting Phone ID and moved conversations to Rajesh Goyal');
  process.exit(0);
});
