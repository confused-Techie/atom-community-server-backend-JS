# Major Todo

This is a collection/list of all functions/methods of the Backend API, with their status of completion listed.

๐ : Finished
โ : In Progress, or partially completed
๐ : Hasn't been started.
๐งช : Needs Testing

### Main.js

* ALL endpoints need additional testing, as the underlying functions are seeing continuous change: ๐งช

* GET /api/packages : ๐
* POST /api/packages : โ
* GET /api/packages/search : ๐
* GET /api/packages/:packageName : ๐
* DELETE /api/packages/:packageName : โ
* POST /api/packages/:packageName/star : ๐
* DELETE /api/packages/:packageName/star : ๐
* GET /api/packages/:packageName/stargazers : ๐
* POST /api/packages/:packageName/versions : โ
* GET /api/packages/:packageName/versions/:versionName : ๐
* GET /api/packages/:packageName/versions/:versionName/tarball: ๐
* DELETE /api/packages/:packageName/versions/:versionName : โ
* GET /api/users/:login/stars : ๐
* GET /api/stars : ๐
* GET /api/updates : ๐

### Query.js

* page(): ๐
* sort(): ๐
* dir(): ๐
* query(): ๐
* engine(): ๐
* repo(): ๐
* tag(): ๐
* rename(): ๐
* pathTraversalAttempt(): ๐

### Collection.js

* Sort(): ๐
* Direction(): ๐
* POFPrune(): ๐
* POSPrune(): ๐
* SearchWithinPackages(): ๐
* EngineFilter(): ๐

### Users.js

* VerifyAuth(): ๐
* GetUser(): ๐
* AddUserStar(): ๐
* RemoveUserStar(): ๐
* Prune(): ๐

### Data.js

* GetUsers(): ๐
* SetUsers(): ๐
* GetPackagePointer(): ๐
* SetPackagePointer(): ๐
* GetPackageByID(): ๐
* GetPackageByName(): ๐
* GetPackagePointerByName(): ๐
* GetAllPackages(): ๐
* GetPackageCollection(): ๐
* StarPackageByName(): ๐
* UnStarPackageByName(): ๐
* SetPackageByID(): ๐
* NewPackage(): ๐

### Git.js

* VerifyAuth(): ๐
* Ownership(): ๐

### Config.js

* GetConfig(): ๐

### Search.js

* levenshtein(): ๐
* vlEditDistance(): ๐
* levenshteinWSDM(): ๐
* lcs(): ๐
* lcsTraceBack(): ๐

### Error.js

* NotFoundJSON(): ๐
* SiteWide404(): ๐
* MissingAuthJSON(): ๐
* ServerErrorJSON(): ๐
* UnsupportedJSON(): ๐

### Logger.js

* HTTPLog(): ๐
* ErrorLog(): ๐
* WarningLog(): ๐
* InfoLog(): ๐
