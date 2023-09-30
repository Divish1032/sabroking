const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const LocalStrategy = require("passport-local").Strategy;

var fs = require("fs");
var path = require("path");
var multer = require("multer");

const GridFsStorage = require("multer-gridfs-storage").GridFsStorage;
const Grid = require("gridfs-stream");
const methodOverride = require("method-override");

const app = express();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use(
  session({
    secret: "sabroking",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

const mongoURI = "mongodb+srv://vaibhav412:v12345a@cluster0.if63g.mongodb.net/sabrokingDB";

// const url = "mongodb://<username>:<password>@main-shard-00-00-03xkr.mongodb.net:27017,main-shard-00-01-03xkr.mongodb.net:27017,main-shard-00-02-03xkr.mongodb.net:27017/main?ssl=true&replicaSet=Main-shard-0&authSource=admin&retryWrites=true";

const options = {
  autoIndex: false, // Don't build indexes
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
};

mongoose.connect(mongoURI, options);

const conn = mongoose.createConnection(mongoURI, options);

// Init gfs
let gfs;

conn.once("open", () => {
  // Init stream
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection("uploads");
});

// Create storage engine
const storage = new GridFsStorage({
  url: mongoURI,
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      const filename = file.originalname;
      const fileInfo = {
        filename: filename,
        bucketName: "uploads",
      };
      resolve(fileInfo);
    });
  },
});
const upload = multer({ storage });

const sabrokingSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  username: String,
  password: String,
  role: Number,
  file_path: Array,
});

sabrokingSchema.plugin(passportLocalMongoose);

const User = new mongoose.model("User", sabrokingSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

app.get("/", function (req, res) {
  var isAuthenticated = req.isAuthenticated();
  res.render("home", { isAuthenticated: isAuthenticated });
});

// app.get("/about", function (req, res) {
//   res.render("about");
// });

app.get("/formdownload", (req, res) => {
  var path = __dirname + "/" + req.query.download;
  res.download(path);
});

app.get("/dashboard", function (req, res) {
  if (req.isAuthenticated() && req.user.role == 0) {
    User.findOne(
      {
        _id: req.user._id,
      },
      function (err, user) {
        res.render("userdashboard", {
          user: user,
        });
      }
    );
  } else {
    res.redirect("/");
  }
});

app.get("/investor-corner", function (req, res) {
  if (req.isAuthenticated() && req.user.role == 0) {
    User.findOne(
      {
        _id: req.user._id,
      },
      function (err, user) {
        res.render("investor", {
          user: user,
        });
      }
    );
  } else {
    res.redirect("/");
  }
});

app.get("/admin/dashboard", function (req, res) {
  if (req.isAuthenticated()) {
    if (req.user.role == 1) {
      User.find({}, function (err, users) {
        res.render("admindashboard", { users: users });
      });
    } else {
      res.redirect("/admin");
    }
  } else {
    res.redirect("/admin");
  }
});

app.get("/admin/:userId", function (req, res) {
  const requestedUserId = req.params.userId;
  if (req.isAuthenticated() && req.user.role == 1) {
    User.findOne(
      {
        _id: requestedUserId,
      },
      function (err, user) {
        gfs.files.find().toArray((err, files) => {
          res.render("uploadfile", { files: files, user: user });
        });
      }
    );
  } else {
    res.redirect("/admin");
  }
});

app.post("/admin/:userId", upload.array("file", 5), (req, res) => {
  const requestedUserId = req.params.userId;
  if (req.isAuthenticated() && req.user.role == 1) {
    for (i = 0; i < req.files.length; i++) {
      var x = req.files[i].filename;
      User.findByIdAndUpdate(
        requestedUserId,
        { $push: { file_path: x } },
        { safe: true, upsert: true },
        function (err, doc) {
          if (err) {
            console.log(err);
          } else {
            console.log(doc);
          }
        }
      );
    }
    res.redirect("/admin/" + requestedUserId);
  } else {
    res.redirect("/admin");
  }
});

app.get("/download/:filename", (req, res) => {
  if (req.isAuthenticated()) {
    const filename = req.params.filename;

    gfs.files.findOne({ filename: filename }, (err, file) => {
      const readstream = gfs.createReadStream(file.filename);
      readstream.pipe(res);
      console.log(file);
    });
  } else {
    res.redirect("/");
  }
});

app.get("/delete/:filename", (req, res) => {
  if (req.isAuthenticated() && req.user.role == 1) {
    const filename = req.params.filename;

    gfs.remove({ filename: filename, root: "uploads" }, (err, gridStore) => {
      if (err) {
        return res.status(404).json({ err: err });
      }
      User.findByIdAndUpdate(
        req.query.userId,

        { $pull: { file_path: filename } },
        { safe: true, upsert: true },
        function (err, doc) {
          if (err) {
            console.log(err);
          } else {
            res.redirect("/admin/" + req.query.userId);
          }
        }
      );
    });
  } else {
    res.redirect("/admin");
  }
});

app.get("/admin", function (req, res) {
  if (req.isAuthenticated() && req.user.role == 1) {
    res.redirect("/admin/dashboard");
  } else {
    if (req.isAuthenticated() && req.user.role == 0) {
      res.redirect("/dashboard");
    } else {
      res.render("admin");
    }
  }
});

app.post("/admin", function (req, res) {
  User.findOne(
    {
      username: req.body.username,
    },
    function (err, user) {
      if (user && user.role == 1) {
        const user = new User({
          username: req.body.username,
          password: req.body.password,
        });
        req.login(user, function (err) {
          if (err) {
            console.log(err);
            res.redirect("/");
          } else {
            passport.authenticate("local")(req, res, function () {
              res.redirect("/admin/dashboard");
            });
          }
        });
      } else {
        res.redirect("/admin");
      }
    }
  );
});

app.post("/register", function (req, res) {
  if (req.isAuthenticated() && req.user.role == 1) {
    User.register(
      {
        username: req.body.username,
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        role: 0,
        file_path: [],
      },
      req.body.password,
      function (err, user) {
        if (err) {
          console.log(err);
          res.redirect("/admin/dashboard");
        } else {
          res.redirect("/admin/dashboard");
        }
      }
    );
  } else {
    res.redirect("/admin");
  }
});

app.post("/login", function (req, res) {
  User.findOne(
    {
      username: req.body.username,
    },
    function (err, user) {
      if (user && user.role == 0) {
        const user = new User({
          username: req.body.username,
          password: req.body.password,
        });
        req.login(user, function (err) {
          if (err) {
            console.log(err);
            res.redirect("/");
          } else {
            passport.authenticate("local")(req, res, function () {
              res.redirect("/dashboard");
            });
          }
        });
      } else {
        res.redirect("/");
      }
    }
  );
});

app.get("/logout", function (req, res) {
  req.logout();
  req.session.destroy(function () {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}
app.listen(port, function () {
  console.log("Server started at port 3000.");
});
