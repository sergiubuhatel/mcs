import { all, fork } from "redux-saga/effects";
import companiesSaga from "../features/companies/companiesSaga";
import poolsSaga from "../features/pools/poolsSaga";
import portfoliosSaga from "../features/portfolios/portfoliosSaga";
import rlSaga from "../features/rl/rlSaga";
import predictionsSaga from "../features/predictions/predictionsSaga";
import dataImportSaga from "../features/dataImport/dataImportSaga";

export default function* rootSaga() {
  yield all([
    fork(companiesSaga),
    fork(poolsSaga),
    fork(portfoliosSaga),
    fork(rlSaga),
    fork(predictionsSaga),
    fork(dataImportSaga),
  ]);
}
