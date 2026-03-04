const User = require('./User');
const Event = require('./Event');
const EventMember = require('./EventMember');

// Event <-> User (organizer)
Event.belongsTo(User, { foreignKey: 'organizer_id', as: 'organizer' });
User.hasMany(Event, { foreignKey: 'organizer_id', as: 'events' });

// EventMember <-> Event
EventMember.belongsTo(Event, { foreignKey: 'event_id' });
Event.hasMany(EventMember, { foreignKey: 'event_id' });

// EventMember <-> User
EventMember.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(EventMember, { foreignKey: 'user_id' });

module.exports = { User, Event, EventMember };
