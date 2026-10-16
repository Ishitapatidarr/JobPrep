import { createBrowserRouter } from "react-router";

import Login from "./features/auth/pages/Login.jsx";
import Register from "./features/auth/pages/Register.jsx";
 import Protected from "./features/auth/components/Protected";
//import Home from "./features/interview/pages/Home";
// import Interview from "./features/interview/pages/Interview";


export const router = createBrowserRouter([
    {
        path: "/login",
        element: <Login />
    },
    {
        path: "/register",
        element: <Register />
    },
     {
        path: "/",
        element: <Protected><p>Home</p></Protected>
    }
    // {
    //     path:"/interview/:interviewId",
    //     element: <Protected><Interview /></Protected>
    // }
]);

export default router;