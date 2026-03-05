const User = require('./User');
const Event = require('./Event');
const EventMember = require('./EventMember');
const Photo = require('./Photo');
const PhotoFace = require('./PhotoFace');

// Event <-> User (organizer)
Event.belongsTo(User, { foreignKey: 'organizer_id', as: 'organizer' });
User.hasMany(Event, { foreignKey: 'organizer_id', as: 'events' });

// EventMember <-> Event
EventMember.belongsTo(Event, { foreignKey: 'event_id' });
Event.hasMany(EventMember, { foreignKey: 'event_id' });

// EventMember <-> User
EventMember.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(EventMember, { foreignKey: 'user_id' });

// Photo <-> Event + User
Photo.belongsTo(Event, { foreignKey: 'event_id' });
Photo.belongsTo(User, { foreignKey: 'uploader_id', as: 'uploader' });
Event.hasMany(Photo, { foreignKey: 'event_id' });
User.hasMany(Photo, { foreignKey: 'uploader_id' });

// PhotoFace <-> Photo
Photo.hasMany(PhotoFace, { foreignKey: 'photo_id' });
PhotoFace.belongsTo(Photo, { foreignKey: 'photo_id' });

module.exports = { User, Event, EventMember, Photo, PhotoFace };
