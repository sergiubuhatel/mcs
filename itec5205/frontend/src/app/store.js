import { combineReducers, configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";

import companiesReducer from "../features/companies/companiesSlice";
import poolsReducer from "../features/pools/poolsSlice";
import portfoliosReducer from "../features/portfolios/portfoliosSlice";
import rlReducer from "../features/rl/rlSlice";
import predictionsReducer from "../features/predictions/predictionsSlice";
import dataImportReducer from "../features/dataImport/dataImportSlice";
import themeReducer from "../features/theme/themeSlice";
import rootSaga from "./rootSaga";

const rootReducer = combineReducers({
  companies: companiesReducer,
  pools: poolsReducer,
  portfolios: portfoliosReducer,
  rl: rlReducer,
  predictions: predictionsReducer,
  dataImport: dataImportReducer,
  theme: themeReducer,
});

const sagaMiddleware = createSagaMiddleware();

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ thunk: false }).concat(sagaMiddleware),
});

sagaMiddleware.run(rootSaga);
